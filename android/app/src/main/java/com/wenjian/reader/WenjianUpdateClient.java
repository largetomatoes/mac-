package com.wenjian.reader;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.spec.X509EncodedKeySpec;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.net.ssl.HttpsURLConnection;
import android.util.Base64;
import android.util.AtomicFile;

final class WenjianUpdateClient {
 private static final String PUBLIC_KEY="MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEArtKzBMH+SEwYw9952J56XHyiik0/jRdKyYBhwHSCMsAJlmrrIff69rCzDY2pvMTTxdQUbZ14CEbnM5TC5V0V5qkOpS0ReMoMcbQFPe36YecOhqzjytHVMZMZCH3DFY9NT5tBkTNBbG50BMjfmXG6s+56TnHrmBr8MfjBlal8ai81GHzyGip9UHIw4vV7+VLl4PcGu54db/Z3Ny1MXh0dTqUstu0lNGYQ0fMBy28Gx/t++/a39kV3eiFegoTPvYCPK4Z58MezrrQYkluder3y76V9/jMOZlRZowZ1Q8HKONIKitsgflqSUeVFnfbtipDB0tE8lZLw2bS9hPDb9g8agqdhMyOlRx7V0XtXc6ROAOnFxzLX39BNScgvA8Eup/nlkrU1H2L8D3qEenU13Z0B1oLl3ldCfvwSg3cFTUeyU3DBcug76OOQieWIlUxCBC8GaMMtef6EVh9iBCS6dhF7XC917ImQr7upHDjimpzEaWeoWaFJ/e5AY2QtAEmE5xIbAgMBAAE=";
 private final Context context;
 private final ExecutorService network=Executors.newSingleThreadExecutor();
 private final AtomicBoolean cancelled=new AtomicBoolean();
 private volatile JSONObject state=new JSONObject();
 private volatile HttpsURLConnection connection;
 private File apk;private JSONObject signed,asset;private String version;
 WenjianUpdateClient(Context value){context=value;set(new File(context.getCacheDir(),"wenjian-updates/ready.json").exists()?"verifying":"idle",null);network.execute(()->{try{File metadata=new File(cache(),"ready.json");if(!metadata.exists()){set("idle",null);return;}JSONObject saved;try(InputStream in=new AtomicFile(metadata).openRead();ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1){if(out.size()+n>1024*1024)throw new IOException("更新缓存信息过大");out.write(b,0,n);}saved=new JSONObject(out.toString("UTF-8"));}version=saved.getString("version");signed=saved.getJSONObject("envelope");long build=verifiedPayload(signed).getLong("build");if(build<=installedBuild()){metadata.delete();set("succeeded",null);return;}set("verifying",null);asset=verify(signed);apk=new File(cache(),"Wenjian-"+version+".apk");if(!apk.isFile()||apk.length()!=asset.getLong("size")||!hash(apk).equals(asset.getString("sha256")))throw new IOException("暂存更新包已变化，请重新下载");verifyApk(apk);set("ready",null);}catch(Exception e){set("failed",e.getMessage());}});}
 private void persistReady()throws Exception{AtomicFile file=new AtomicFile(new File(cache(),"ready.json"));FileOutputStream stream=null;try{stream=file.startWrite();stream.write(new JSONObject().put("version",version).put("envelope",signed).toString().getBytes(StandardCharsets.UTF_8));file.finishWrite(stream);}catch(Exception e){if(stream!=null)file.failWrite(stream);throw e;}}
 private synchronized void set(String phase,String error){try{JSONObject next=new JSONObject().put("state",phase);if(version!=null)next.put("version",version);if(error!=null)next.put("error",error);state=next;}catch(JSONException ignored){}}
 synchronized JSONObject status(){try{return new JSONObject(state.toString());}catch(Exception e){return new JSONObject();}}
 private File cache()throws IOException{File dir=new File(context.getCacheDir(),"wenjian-updates");if(!dir.exists()&&!dir.mkdirs())throw new IOException("无法创建更新缓存");return dir;}
 private long installedBuild()throws Exception{PackageInfo info=context.getPackageManager().getPackageInfo(context.getPackageName(),0);return Build.VERSION.SDK_INT>=28?info.getLongVersionCode():info.versionCode;}
 private URL trusted(String value)throws Exception{URL url=new URL(value);if(!"https".equals(url.getProtocol())||url.getUserInfo()!=null||url.getPort()!=-1||!Arrays.asList("github.com","api.github.com","release-assets.githubusercontent.com","objects.githubusercontent.com").contains(url.getHost()))throw new IOException("更新地址不受信任");return url;}
 private HttpsURLConnection open(String value,int redirects)throws Exception{if(redirects>5)throw new IOException("更新跳转过多");URL url=trusted(value);HttpsURLConnection c=(HttpsURLConnection)url.openConnection();connection=c;c.setConnectTimeout(15000);c.setReadTimeout(30000);c.setInstanceFollowRedirects(false);c.setRequestProperty("User-Agent","Wenjian-Signed-Updater");int code=c.getResponseCode();if(code>=300&&code<400){String location=c.getHeaderField("Location");c.disconnect();if(location==null)throw new IOException("更新跳转无效");return open(new URL(url,location).toString(),redirects+1);}if(code!=200){c.disconnect();throw new IOException("更新请求失败（"+code+"）");}return c;}
 private JSONObject json(String value)throws Exception{HttpsURLConnection c=open(value,0);try(InputStream in=c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1){if(out.size()+n>1024*1024)throw new IOException("更新清单过大");out.write(b,0,n);}return new JSONObject(out.toString("UTF-8"));}finally{c.disconnect();}}
 private JSONObject verifiedPayload(JSONObject envelope)throws Exception{
  String payload=envelope.getString("payload");if(payload.length()>1024*1024)throw new IOException("更新清单过大");
  PublicKey key=KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(Base64.decode(PUBLIC_KEY,Base64.DEFAULT)));
  java.security.Signature sig=java.security.Signature.getInstance("SHA256withRSA");sig.initVerify(key);sig.update(payload.getBytes(StandardCharsets.UTF_8));if(!sig.verify(Base64.decode(envelope.getString("signature"),Base64.DEFAULT)))throw new IOException("更新发布签名验证失败");
  JSONObject m=new JSONObject(payload);if(m.getInt("schema")!=1||version==null||!version.matches("3[.][0-9]{1,50}")||!m.getString("version").equals(version))throw new IOException("更新版本信息不匹配");return m;
 }
 private JSONObject verify(JSONObject envelope)throws Exception{JSONObject m=verifiedPayload(envelope);if(m.getLong("build")<=installedBuild())throw new IOException("更新版本已经安装");
  JSONArray entries=m.getJSONArray("assets");for(int i=0;i<entries.length();i++){JSONObject a=entries.getJSONObject(i);if(a.optString("platform").equals("android")){long size=a.getLong("size");if(size<1||size>1024L*1024*1024||!a.getString("sha256").matches("[a-f0-9]{64}"))throw new IOException("更新包校验信息无效");URL url=trusted(a.getString("url"));if(!url.getHost().equals("github.com")||!url.getPath().startsWith("/largetomatoes/mac-/releases/download/v"+version+"/"))throw new IOException("更新包来源不匹配");return a;}}throw new IOException("没有Android更新包");
 }
 private static String hash(File file)throws Exception{MessageDigest digest=MessageDigest.getInstance("SHA-256");try(InputStream in=new FileInputStream(file)){byte[] b=new byte[65536];int n;while((n=in.read(b))!=-1)digest.update(b,0,n);}StringBuilder s=new StringBuilder();for(byte v:digest.digest())s.append(String.format(Locale.ROOT,"%02x",v&255));return s.toString();}
 synchronized JSONObject start(String wanted,String manifestUrl)throws Exception{
  String phase=state.optString("state");if(phase.equals("downloading")||phase.equals("verifying")||phase.equals("ready")&&Objects.equals(version,wanted))return status();
  if(wanted==null||!wanted.matches("3[.][0-9]{1,50}")||manifestUrl==null||!manifestUrl.startsWith("https://github.com/largetomatoes/mac-/releases/download/v"+wanted+"/"))throw new IOException("更新来源无效");
  version=wanted;cancelled.set(false);set("downloading",null);
  network.execute(()->{File partial=null;try{
   signed=json(manifestUrl);asset=verify(signed);long expected=asset.getLong("size");File dir=cache();if(dir.getUsableSpace()<expected*3)throw new IOException("更新可用空间不足");apk=new File(dir,"Wenjian-"+version+".apk");partial=new File(apk+".partial");
   HttpsURLConnection c=open(asset.getString("url"),0);long total=0;try(InputStream in=c.getInputStream();FileOutputStream out=new FileOutputStream(partial)){byte[] b=new byte[65536];int n;while((n=in.read(b))!=-1){if(cancelled.get())throw new IOException("下载已取消");total+=n;if(total>expected)throw new IOException("更新包超过清单大小");out.write(b,0,n);synchronized(this){state.put("completed",total).put("total",expected);}}out.getFD().sync();}finally{c.disconnect();}
   set("verifying",null);if(total!=expected||!hash(partial).equals(asset.getString("sha256")))throw new IOException("更新包校验失败");verifyApk(partial);if(apk.exists()&&!apk.delete())throw new IOException("旧更新缓存无法移除");if(!partial.renameTo(apk))throw new IOException("更新缓存无法保存");persistReady();set("ready",null);
  }catch(Exception e){if(partial!=null)partial.delete();set(cancelled.get()?"cancelled":"failed",e.getMessage());}});
  return status();
 }
 synchronized JSONObject cancel(){cancelled.set(true);HttpsURLConnection c=connection;if(c!=null)c.disconnect();return status();}
 @SuppressWarnings("deprecation")
 private void verifyApk(File file)throws Exception{
  PackageManager pm=context.getPackageManager();int flags=Build.VERSION.SDK_INT>=28?PackageManager.GET_SIGNING_CERTIFICATES:PackageManager.GET_SIGNATURES;
  PackageInfo current=pm.getPackageInfo(context.getPackageName(),flags),next=pm.getPackageArchiveInfo(file.getAbsolutePath(),flags);
  if(next==null||!Objects.equals(next.versionName,version)||!context.getPackageName().equals(next.packageName)||(Build.VERSION.SDK_INT>=28?next.getLongVersionCode():next.versionCode)<=installedBuild())throw new IOException("安装包身份或版本不匹配");
  if((Build.VERSION.SDK_INT>=28?next.getLongVersionCode():next.versionCode)!=new JSONObject(signed.getString("payload")).getLong("build"))throw new IOException("安装包构建号与清单不一致");
  android.content.pm.Signature[] left=Build.VERSION.SDK_INT>=28?current.signingInfo.getApkContentsSigners():current.signatures;
  android.content.pm.Signature[] right=Build.VERSION.SDK_INT>=28?next.signingInfo.getApkContentsSigners():next.signatures;
  if(left.length!=right.length)throw new IOException("安装包签名不一致");for(int i=0;i<left.length;i++)if(!Arrays.equals(left[i].toByteArray(),right[i].toByteArray()))throw new IOException("安装包签名不一致，请勿卸载原应用");
 }
 private void copy(File from,File to)throws Exception{if(!from.exists())return;try(InputStream in=new FileInputStream(from);FileOutputStream out=new FileOutputStream(to)){byte[] b=new byte[65536];int n;while((n=in.read(b))!=-1)out.write(b,0,n);out.getFD().sync();}}
 synchronized Intent prepareInstall()throws Exception{
  if(apk==null||asset==null||!apk.isFile())throw new IOException("请先下载更新");verify(signed);if(!hash(apk).equals(asset.getString("sha256")))throw new IOException("更新缓存已变化");verifyApk(apk);
  if(Build.VERSION.SDK_INT>=26&&!context.getPackageManager().canRequestPackageInstalls()){set("awaitingPermission",null);return new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+context.getPackageName()));}
  File safeguard=new File(context.getFilesDir(),"update-safeguards/"+System.currentTimeMillis());if(!safeguard.mkdirs())throw new IOException("无法保护当前资料");
  copy(new File(context.getFilesDir(),"reader-store.json"),new File(safeguard,"reader-store.json"));
  Uri uri=FileProvider.getUriForFile(context,context.getPackageName()+".fileprovider",apk);
  Intent intent=new Intent(Intent.ACTION_VIEW).setDataAndType(uri,"application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);set("awaitingSystem",null);return intent;
 }
}
