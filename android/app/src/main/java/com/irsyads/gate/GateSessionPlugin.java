package com.irsyads.gate;

import android.content.Intent;
import android.net.Uri;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "GateSession")
public class GateSessionPlugin extends Plugin {
    private static final String KEY_ALIAS = "irsyads-gate-session-v1";
    private static final int IV_BYTES = 12;

    private AtomicFile vault() {
        return new AtomicFile(new File(getContext().getNoBackupFilesDir(), "gate-session.bin"));
    }

    private SecretKey key(boolean create) throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) return (SecretKey) store.getKey(KEY_ALIAS, null);
        if (!create) throw new GeneralSecurityException("Missing session key");
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .build());
        return generator.generateKey();
    }

    @PluginMethod
    public void read(PluginCall call) {
        try {
            byte[] stored = vault().readFully();
            if (stored.length <= IV_BYTES) throw new GeneralSecurityException("Invalid session file");
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(false), new GCMParameterSpec(128, Arrays.copyOf(stored, IV_BYTES)));
            byte[] value = cipher.doFinal(stored, IV_BYTES, stored.length - IV_BYTES);
            JSObject result = new JSObject();
            result.put("value", new String(value, StandardCharsets.UTF_8));
            call.resolve(result);
        } catch (FileNotFoundException absent) {
            if (vault().getBaseFile().exists()) call.reject("Sesi perangkat belum dapat dibaca.");
            else call.resolve(new JSObject());
        } catch (Exception error) {
            call.reject("Sesi perangkat belum dapat dibaca.");
        }
    }

    @PluginMethod
    public void write(PluginCall call) {
        String value = call.getString("value");
        AtomicFile file = vault();
        FileOutputStream stream = null;
        try {
            if (value == null) {
                file.delete();
                if (file.getBaseFile().exists()) throw new IllegalStateException("Session file still exists");
            } else {
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.ENCRYPT_MODE, key(true));
                if (cipher.getIV().length != IV_BYTES) throw new GeneralSecurityException("Unexpected IV length");
                byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
                stream = file.startWrite();
                stream.write(cipher.getIV());
                stream.write(encrypted);
                file.finishWrite(stream);
            }
            call.resolve();
        } catch (Exception error) {
            if (stream != null) file.failWrite(stream);
            call.reject("Sesi perangkat belum dapat diperbarui.");
        }
    }

    @PluginMethod
    public void open(PluginCall call) {
        Uri uri = Uri.parse(call.getString("url", ""));
        if (!"https".equals(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null ||
            !"/auth/v1/oauth/authorize".equals(uri.getPath())) {
            call.reject("Alamat masuk Irsyads ID tidak valid.");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                getActivity().startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE));
                call.resolve();
            } catch (Exception error) {
                call.reject("Browser perangkat belum dapat dibuka.");
            }
        });
    }
}
