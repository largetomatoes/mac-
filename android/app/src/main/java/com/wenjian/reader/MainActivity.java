package com.wenjian.reader;
import android.os.Bundle;
import android.webkit.WebView;
import android.webkit.RenderProcessGoneDetail;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
public class MainActivity extends BridgeActivity {
 @Override public void onCreate(Bundle state){SyncDiagnostics.install(getApplicationContext());registerPlugin(WenjianStoragePlugin.class);super.onCreate(state);getBridge().addWebViewListener(new WebViewListener(){
  @Override public boolean onRenderProcessGone(WebView view,RenderProcessGoneDetail detail){SyncDiagnostics.hold(getApplicationContext(),true);SyncDiagnostics.event(getApplicationContext(),"webview",detail.didCrash()?"renderer-crashed":"renderer-killed");if(view.getParent() instanceof android.view.ViewGroup)((android.view.ViewGroup)view.getParent()).removeView(view);view.destroy();runOnUiThread(()->{android.widget.LinearLayout layout=new android.widget.LinearLayout(MainActivity.this);layout.setOrientation(android.widget.LinearLayout.VERTICAL);layout.setPadding(48,80,48,48);android.widget.TextView text=new android.widget.TextView(MainActivity.this);text.setText("问间的阅读界面意外中断。已保存的资料仍在本机。\n重新打开后自动同步会暂缓，可在设置导出同步诊断。");text.setTextSize(18);layout.addView(text);android.widget.Button button=new android.widget.Button(MainActivity.this);button.setText("关闭，稍后重新打开");button.setOnClickListener(v->{finishAndRemoveTask();android.os.Process.killProcess(android.os.Process.myPid());});layout.addView(button);setContentView(layout);});return true;}
 });}
}
