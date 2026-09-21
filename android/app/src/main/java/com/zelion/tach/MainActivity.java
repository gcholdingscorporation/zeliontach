package com.zelion.tach;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.provider.Settings;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.PermissionRequest;
import android.webkit.JavascriptInterface;
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
    /* A page's microphone request, held while Android asks for RECORD_AUDIO.
       Denying it up front and asking afterwards fails the page every time. */
    private PermissionRequest pendingWebPermission;
    /* What the WebView actually did with the last request, so the page can
       report a fact instead of inferring one from an API that does not work
       inside a WebView. */
    private volatile String lastPermissionEvent = "never requested";

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
                        boolean wantsAudio = false;
                        for (String r : req.getResources()) {
                            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) wantsAudio = true;
                        }
                        if (!wantsAudio) { req.deny(); return; }

                        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                                == PackageManager.PERMISSION_GRANTED) {
                            lastPermissionEvent = "granted to page";
                            req.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                            return;
                        }
                        lastPermissionEvent = "held, asking android";
                        /* Hold the request open and settle it once Android has
                           answered, rather than denying it and leaving the page
                           to report a failure the person never caused. */
                        if (pendingWebPermission != null) pendingWebPermission.deny();
                        pendingWebPermission = req;
                        requestPermissions(
                                new String[]{Manifest.permission.RECORD_AUDIO}, REQ_AUDIO);
                    }
                });
            }

            @Override
            public void onPermissionRequestCanceled(PermissionRequest req) {
                if (pendingWebPermission == req) pendingWebPermission = null;
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

        /* Only ever loads our own bundled page, so there is nothing untrusted
           on the other side of this bridge. */
        web.addJavascriptInterface(new Host(), "ZelionTachHost");

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
        if (req != REQ_AUDIO) {
            super.onRequestPermissionsResult(req, perms, grants);
            return;
        }
        boolean granted = grants.length > 0 && grants[0] == PackageManager.PERMISSION_GRANTED;

        if (pendingWebPermission != null) {
            if (granted) {
                lastPermissionEvent = "granted to page after asking";
                pendingWebPermission.grant(
                        new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            } else {
                lastPermissionEvent = "android refused";
                pendingWebPermission.deny();
            }
            pendingWebPermission = null;
        }

        /* Refused with "don't ask again": Android will never show the dialog
           here again, so the only way back is the app's own settings page. */
        if (!granted
                && !shouldShowRequestPermissionRationale(Manifest.permission.RECORD_AUDIO)) {
            new AlertDialog.Builder(this)
                    .setTitle("Microphone is switched off")
                    .setMessage("Zelion Tach reads head speed from the microphone, and Android "
                            + "will no longer ask for it here. Turn it on under Permissions, "
                            + "then come back. Recording mode works without it.")
                    .setPositiveButton("Open settings", new android.content.DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(android.content.DialogInterface d, int which) {
                            Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                    Uri.fromParts("package", getPackageName(), null));
                            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                            startActivity(i);
                        }
                    })
                    .setNegativeButton("Not now", null)
                    .show();
        }
    }

    /** Ground truth for the page, which cannot get this from the Permissions API. */
    private class Host {
        @JavascriptInterface
        public String micPermission() {
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                    == PackageManager.PERMISSION_GRANTED) return "granted";
            return shouldShowRequestPermissionRationale(Manifest.permission.RECORD_AUDIO)
                    ? "denied" : "blocked";
        }

        @JavascriptInterface
        public String lastEvent() { return lastPermissionEvent; }

        @JavascriptInterface
        public void openAppSettings() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                            Uri.fromParts("package", getPackageName(), null));
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(i);
                }
            });
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
