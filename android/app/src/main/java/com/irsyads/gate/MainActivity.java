package com.irsyads.gate;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        if (!getPackageName().endsWith(".fixture")) registerPlugin(GateSessionPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
