package com.irsyads.gate;

import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.util.Base64;
import android.webkit.WebView;
import androidx.core.content.FileProvider;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.util.Arrays;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Ekspor dan cetak dari WebView. WebView tidak menangani unduhan blob maupun window.print(), jadi berkas
 * ekspor ditulis ke cache aplikasi lalu dibagikan lewat lembar berbagi sistem (FileProvider), dan cetak
 * memakai PrintManager. Berkas sementara dibuang saat keluar akun dan bila lebih dari satu jam.
 */
@CapacitorPlugin(name = "GateFiles")
public class GateFilesPlugin extends Plugin {
    private static final String DIRECTORY = "exports";
    private static final int MAX_BYTES = 12 * 1024 * 1024;
    private static final long STALE_MS = 60L * 60L * 1000L;
    private static final Pattern NAME = Pattern.compile("^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$");
    private static final List<String> MIME_TYPES = Arrays.asList(
        "text/csv",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document");

    private File exportDirectory() {
        return new File(getContext().getCacheDir(), DIRECTORY);
    }

    private void deleteFiles(boolean onlyStale) {
        File[] files = exportDirectory().listFiles();
        if (files == null) return;
        long limit = System.currentTimeMillis() - STALE_MS;
        for (File file : files) {
            if (file.isFile() && (!onlyStale || file.lastModified() < limit)) file.delete();
        }
    }

    @Override
    public void load() {
        deleteFiles(true);
    }

    @PluginMethod
    public void share(PluginCall call) {
        String name = call.getString("name", "");
        String mime = call.getString("mime", "");
        String data = call.getString("base64", "");
        if (!NAME.matcher(name).matches() || !MIME_TYPES.contains(mime) || data.isEmpty() || data.length() > MAX_BYTES / 3 * 4 + 8) {
            call.reject("Berkas ekspor tidak valid.");
            return;
        }
        try {
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            if (bytes.length == 0 || bytes.length > MAX_BYTES) {
                call.reject("Ukuran berkas ekspor tidak valid.");
                return;
            }
            File directory = exportDirectory();
            if (!directory.isDirectory() && !directory.mkdirs()) throw new IllegalStateException("Cache tidak dapat dibuat");
            deleteFiles(true);
            File file = new File(directory, name);
            try (FileOutputStream out = new FileOutputStream(file, false)) {
                out.write(bytes);
            }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent send = new Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, uri);
            send.setClipData(ClipData.newRawUri(name, uri));
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, name);
            getActivity().runOnUiThread(() -> {
                try {
                    getActivity().startActivity(chooser);
                    call.resolve();
                } catch (Exception error) {
                    call.reject("Lembar berbagi belum dapat dibuka.");
                }
            });
        } catch (Exception error) {
            call.reject("Berkas ekspor belum dapat disiapkan.");
        }
    }

    @PluginMethod
    public void print(PluginCall call) {
        String requested = call.getString("title", "");
        final String jobName = NAME.matcher(requested).matches() ? requested : "Irsyads-Gate";
        getActivity().runOnUiThread(() -> {
            try {
                WebView web = getBridge().getWebView();
                PrintManager manager = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                PrintDocumentAdapter adapter = web.createPrintDocumentAdapter(jobName);
                manager.print(jobName, adapter, new PrintAttributes.Builder().build());
                call.resolve();
            } catch (Exception error) {
                call.reject("Cetak belum dapat dibuka.");
            }
        });
    }

    @PluginMethod
    public void clear(PluginCall call) {
        deleteFiles(false);
        call.resolve();
    }
}
