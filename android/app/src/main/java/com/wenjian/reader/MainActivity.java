package com.wenjian.reader;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
public class MainActivity extends BridgeActivity {
 @Override public void onCreate(Bundle state){registerPlugin(WenjianStoragePlugin.class);super.onCreate(state);}
}
