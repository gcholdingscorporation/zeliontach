package com.zelion.tach;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewFeature;

/**
 * A WebView shell around the tach page, with the one thing a WebView will not
 * do by default handed to the platform: a microphone.
 *
 * getUserMedia refuses to run outside a secure context, and file:// is not one,
 * so the bundled assets are served through WebViewAssetLoader over
 * https://appassets.androidplatform.net/ instead. Nothing leaves the device.
 */
public class MainActivity extends Activity {

    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final String START = ORIGIN + "/assets/index.html";
    private static final int REQ_AUDIO = 101;
    private static final int REQ_FILE = 102;

    private WebView web;
    private ValueCallback<Uri[]> filePicker;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        // Head-speed checks happen with the model running and hands busy.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);

        // Let the page's own dark palette follow the system setting.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(s, true);
        }

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                return loader.shouldInterceptRequest(r.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                if (r.getUrl().toString().startsWith(ORIGIN)) return false;
                startActivity(new Intent(Intent.ACTION_VIEW, r.getUrl()));
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest req) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        for (String r : req.getResources()) {
                            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) {
                                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                                        == PackageManager.PERMISSION_GRANTED) {
                                    req.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                                } else {
                                    req.deny();
                                    requestPermissions(
                                            new String[]{Manifest.permission.RECORD_AUDIO}, REQ_AUDIO);
                                }
                                return;
                            }
                        }
                        req.deny();
                    }
                });
            }

            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb,
                                             FileChooserParams params) {
                if (filePicker != null) filePicker.onReceiveValue(null);
                filePicker = cb;
                try {
                    startActivityForResult(params.createIntent(), REQ_FILE);
                } catch (Exception e) {
                    filePicker = null;
                    return false;
                }
                return true;
            }
        });

        setContentView(web);
        web.loadUrl(START);

        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_AUDIO);
        }
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        if (req == REQ_FILE) {
            if (filePicker != null) {
                filePicker.onReceiveValue(
                        WebChromeClient.FileChooserParams.parseResult(res, data));
                filePicker = null;
            }
            return;
        }
        super.onActivityResult(req, res, data);
    }

    @Override
    public void onRequestPermissionsResult(int req, String[] perms, int[] grants) {
        // Reload only on a grant, so the page can ask again and get a yes.
        if (req == REQ_AUDIO && grants.length > 0
                && grants[0] == PackageManager.PERMISSION_GRANTED) {
            web.reload();
        }
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
