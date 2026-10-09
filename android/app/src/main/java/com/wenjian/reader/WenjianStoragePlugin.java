package com.wenjian.reader;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.text.SimpleDateFormat;
import java.util.*;
import java.util.concurrent.*;
import javax.crypto.*;
import javax.crypto.spec.*;
import javax.net.ssl.HttpsURLConnection;

@CapacitorPlugin(name="WenjianStorage")
public class WenjianStoragePlugin extends Plugin {
    private final ExecutorService disk=Executors.newSingleThreadExecutor();
    private final ExecutorService network=Executors.newFixedThreadPool(2);
    private File directory(){return getContext().getFilesDir();}
    private File bookFile(String name)throws Exception{if(name==null||!name.matches("[a-zA-Z0-9._-]+\\.(pdf|epub)"))throw new Exception("书籍文件名无效");File dir=new File(directory(),"books");if(!dir.exists()&&!dir.mkdirs())throw new IOException("无法创建书库");return new File(dir,name);}
    private interface Task{JSObject run()throws Exception;}
    private void run(ExecutorService pool,PluginCall call,Task task){pool.execute(()->{try{call.resolve(task.run());}catch(Exception error){call.reject(error.getMessage()==null?"操作未完成":error.getMessage());}});}
    private static byte[] read(InputStream stream,long max)throws Exception{try(InputStream in=stream;ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] buffer=new byte[65536];int n;long total=0;while((n=in.read(buffer))!=-1){total+=n;if(total>max)throw new IOException("文件超出读取限额");out.write(buffer,0,n);}return out.toByteArray();}}
    private void atomic(File target,byte[] bytes)throws Exception{AtomicFile file=new AtomicFile(target);FileOutputStream out=null;try{out=file.startWrite();out.write(bytes);file.finishWrite(out);}catch(Exception error){if(out!=null)file.failWrite(out);throw error;}}
    @PluginMethod public void appReleases(PluginCall call){run(network,call,()->{
        HttpsURLConnection conn=(HttpsURLConnection)new URL("https://api.github.com/repos/largetomatoes/mac-/releases?per_page=30").openConnection();
        conn.setConnectTimeout(8000);conn.setReadTimeout(8000);conn.setInstanceFollowRedirects(false);conn.setRequestProperty("User-Agent","Wenjian-Update-Check");conn.setRequestProperty("Accept","application/vnd.github+json");
        try{int status=conn.getResponseCode();if(status!=200)throw new IOException(status==403||status==429?"更新检查达到访问限额，请稍后重试。":"未能读取正式发布信息，请稍后重试。");JSONArray releases=new JSONArray(new String(read(conn.getInputStream(),4L*1024*1024),StandardCharsets.UTF_8));return new JSObject().put("releases",releases);}catch(SocketTimeoutException e){throw new IOException("连接发布服务器超时，请稍后重试。");}finally{conn.disconnect();}
    });}
    @PluginMethod public void openRelease(PluginCall call){
        String value=call.getString("url");
        try{URI uri=new URI(value==null?"":value);String p=uri.getPath();if(!"https".equals(uri.getScheme())||!"github.com".equals(uri.getHost())||uri.getPort()!=-1||uri.getUserInfo()!=null||uri.getQuery()!=null||uri.getFragment()!=null||p==null||!(p.equals("/largetomatoes/mac-/releases")||p.startsWith("/largetomatoes/mac-/releases/tag/")||p.startsWith("/largetomatoes/mac-/releases/download/")))throw new Exception("发布链接无效");
            getActivity().runOnUiThread(()->{try{getActivity().startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(value)));call.resolve(new JSObject().put("ok",true));}catch(Exception e){call.reject("未能打开浏览器，请检查系统浏览器。");}});
        }catch(Exception e){call.reject("发布链接无效");}
    }
    @PluginMethod public void readStore(PluginCall call){run(disk,call,()->{File file=new File(directory(),"reader-store.json");JSObject result=new JSObject();if(file.exists()||new File(file+".bak").exists())result.put("text",new String(read(new AtomicFile(file).openRead(),128L*1024*1024),StandardCharsets.UTF_8));return result;});}
    @PluginMethod public void writeStore(PluginCall call){run(disk,call,()->{String text=call.getString("text");if(text==null||text.length()>128*1024*1024)throw new Exception("本地资料过大");new JSONObject(text);File target=new File(directory(),"reader-store.json");if(target.exists())atomic(new File(directory(),"reader-previous.json"),read(new FileInputStream(target),128L*1024*1024));atomic(target,text.getBytes(StandardCharsets.UTF_8));return new JSObject().put("ok",true);});}
    @PluginMethod public void bookInfo(PluginCall call){run(disk,call,()->{File file=bookFile(call.getString("name"));return new JSObject().put("available",file.isFile()).put("uri",Uri.fromFile(file).toString());});}
    @PluginMethod public void importBook(PluginCall call){Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType("*/*");intent.putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"application/pdf","application/epub+zip"});startActivityForResult(call,intent,"bookPicked");}
    @ActivityCallback private void bookPicked(PluginCall call,ActivityResult result){if(call==null)return;if(result.getResultCode()!=Activity.RESULT_OK||result.getData()==null){call.resolve(new JSObject().put("cancelled",true));return;}Uri uri=result.getData().getData();run(network,call,()->{
        String name="书籍";try(Cursor cursor=getContext().getContentResolver().query(uri,null,null,null,null)){if(cursor!=null&&cursor.moveToFirst()){int column=cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);if(column>=0)name=cursor.getString(column);}}
        String format=name.toLowerCase(Locale.ROOT).endsWith(".epub")?"epub":name.toLowerCase(Locale.ROOT).endsWith(".pdf")?"pdf":"";if(format.isEmpty())throw new Exception("请选择 PDF 或 EPUB 文件");
        File temporary=new File(directory(),"import-"+UUID.randomUUID());MessageDigest digest=MessageDigest.getInstance("SHA-256");long size=0;
        try{try(InputStream in=getContext().getContentResolver().openInputStream(uri);FileOutputStream out=new FileOutputStream(temporary)){if(in==null)throw new IOException("无法读取文件");byte[] buffer=new byte[65536];int n;while((n=in.read(buffer))!=-1){size+=n;if(size>5L*1024*1024*1024)throw new IOException("书籍超过 5 GB");digest.update(buffer,0,n);out.write(buffer,0,n);}out.getFD().sync();}
          try(FileInputStream check=new FileInputStream(temporary)){byte[] header=new byte[5];int count=check.read(header);if(count<4||("pdf".equals(format)?!new String(header,StandardCharsets.US_ASCII).equals("%PDF-"):(header[0]!=80||header[1]!=75)))throw new IOException("文件格式与扩展名不符");}
          String sha=hex(digest.digest()),stored=sha+"."+format;File target=bookFile(stored);if(!target.exists()&&!temporary.renameTo(target))throw new IOException("书籍保存失败");return new JSObject().put("name",name).put("storedFile",stored).put("format",format).put("sha256",sha).put("size",size);
        }finally{temporary.delete();}
    });}
    private SecretKey key()throws Exception{KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);String alias="wenjian-oss-v1";if(!store.containsAlias(alias)){KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");generator.init(new KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());generator.generateKey();}return (SecretKey)store.getKey(alias,null);}
    private JSONObject config()throws Exception{File file=new File(directory(),"oss-secure.json");if(!file.exists())return null;JSONObject saved=new JSONObject(new String(read(new AtomicFile(file).openRead(),65536),StandardCharsets.UTF_8));Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(saved.getString("iv"),Base64.NO_WRAP)));return new JSONObject(new String(cipher.doFinal(Base64.decode(saved.getString("data"),Base64.NO_WRAP)),StandardCharsets.UTF_8));}
    private JSObject publicConfig(JSONObject cfg)throws Exception{JSObject result=new JSObject().put("configured",cfg!=null);if(cfg!=null)for(String field:new String[]{"region","bucket","prefix","accessKeyId"})result.put(field,cfg.getString(field));return result;}
    @PluginMethod public void getConfig(PluginCall call){run(disk,call,()->publicConfig(config()));}
    @PluginMethod public void setConfig(PluginCall call){run(disk,call,()->{JSONObject input=call.getObject("config"),old=config();if(input==null)throw new Exception("请填写 OSS 设置");String region=input.optString("region"),bucket=input.optString("bucket"),prefix=input.optString("prefix","wenjian/"),id=input.optString("accessKeyId"),secret=input.optString("accessKeySecret");if(secret.isEmpty()&&old!=null)secret=old.getString("accessKeySecret");if(!region.matches("[a-z][a-z0-9]*(-[a-z0-9]+)+")||!bucket.matches("[a-z0-9][a-z0-9-]{1,61}[a-z0-9]")||!id.matches("[A-Za-z0-9_-]{8,128}")||secret.length()<8||secret.length()>256||secret.contains("\n")||secret.contains("\r"))throw new Exception("OSS 设置格式不正确");if(prefix.isEmpty())prefix="wenjian/";if(prefix.startsWith("/")||prefix.contains("..")||prefix.contains("//")||prefix.matches(".*[\\\\?#\\p{Cntrl}].*")||prefix.length()>500)throw new Exception("目录前缀格式不正确");if(!prefix.endsWith("/"))prefix+="/";JSONObject cfg=new JSONObject().put("region",region).put("bucket",bucket).put("prefix",prefix).put("accessKeyId",id).put("accessKeySecret",secret);File notebook=new File(directory(),"reader-store.json");if(notebook.exists()&&"oss".equals(connectionConfig().optString("provider"))){JSONObject sync=new JSONObject(new String(read(new AtomicFile(notebook).openRead(),128L*1024*1024),StandardCharsets.UTF_8)).optJSONObject("sync");if(sync!=null&&!sync.optString("target").isEmpty()&&!sync.optString("target").equals(ossTarget(cfg))&&!canCorrectUnconfirmedSync(sync))throw new Exception("请先在三端同步中更换资料库，再修改 OSS 位置");}Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());byte[] bytes=cipher.doFinal(cfg.toString().getBytes(StandardCharsets.UTF_8));JSONObject encrypted=new JSONObject().put("iv",Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)).put("data",Base64.encodeToString(bytes,Base64.NO_WRAP));atomic(new File(directory(),"oss-secure.json"),encrypted.toString().getBytes(StandardCharsets.UTF_8));return publicConfig(cfg);});}

    private JSONObject connectionConfig()throws Exception{
        File file=new File(directory(),"sync-connection-secure.json");if(!file.exists())return new JSONObject().put("provider","oss");
        JSONObject saved=new JSONObject(new String(read(new AtomicFile(file).openRead(),65536),StandardCharsets.UTF_8));Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(saved.getString("iv"),Base64.NO_WRAP)));return new JSONObject(new String(cipher.doFinal(Base64.decode(saved.getString("data"),Base64.NO_WRAP)),StandardCharsets.UTF_8));
    }
    private static String ossTarget(JSONObject cfg)throws Exception{return cfg==null?"":cfg.getString("region")+"/"+cfg.getString("bucket")+"/"+cfg.getString("prefix");}
    private JSObject syncIdentity()throws Exception{
        JSONObject connection=connectionConfig();String provider=connection.optString("provider","oss"),target="nutstore".equals(provider)?(connection.has("username")?NutstoreClient.target(connection):""):ossTarget(config());
        return new JSObject().put("provider",provider).put("configured","nutstore".equals(provider)?connection.has("password"):config()!=null).put("username",connection.optString("username")).put("target",target).put("verified",!target.isEmpty()&&target.equals(connection.optString("checkedTarget"))).put("remoteHasData",connection.optBoolean("remoteHasData")).put("directory","问间资料库");
    }
    @PluginMethod public void getSyncIdentity(PluginCall call){run(disk,call,()->syncIdentity());}
    private static boolean canCorrectUnconfirmedSync(JSONObject sync)throws JSONException {
        if(!sync.optString("lastSync").isEmpty()||sync.optString("device").isEmpty()||(sync.optJSONArray("published")!=null&&sync.getJSONArray("published").length()>0))return false;
        JSONArray received=sync.optJSONArray("received"),operations=sync.optJSONArray("operations"),pending=sync.optJSONArray("pending");
        if(received==null||received.length()!=0||operations==null||pending==null||operations.length()!=pending.length())return false;
        Map<String,JSONObject> queued=new HashMap<>();
        for(int i=0;i<pending.length();i++){JSONObject operation=pending.getJSONObject(i);queued.put(operation.getString("id"),operation);}
        if(queued.size()!=pending.length())return false;
        for(int i=0;i<operations.length();i++){JSONObject operation=operations.getJSONObject(i),copy=queued.get(operation.getString("id"));if(!sync.getString("device").equals(operation.optString("device"))||copy==null||!copy.toString().equals(operation.toString()))return false;}
        return true;
    }
    private JSONObject candidate(JSONObject input)throws Exception{
        if(input==null)throw new Exception("请选择同步服务");JSONObject old=connectionConfig();String provider=input.optString("provider");
        if("nutstore".equals(provider)){String username=input.optString("username").trim().toLowerCase(Locale.ROOT);return NutstoreClient.validate(input,username.equals(old.optString("username"))?old.optString("password"):"").put("provider",provider);}
        if("oss".equals(provider)&&config()!=null)return new JSONObject().put("provider","oss");throw new Exception("请先配置同步服务");
    }
    private void saveConnection(JSONObject next)throws Exception{
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());JSONObject encrypted=new JSONObject().put("iv",Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)).put("data",Base64.encodeToString(cipher.doFinal(next.toString().getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP));atomic(new File(directory(),"sync-connection-secure.json"),encrypted.toString().getBytes(StandardCharsets.UTF_8));
    }
    private JSObject applyConnection(JSONObject next,JSONObject verification)throws Exception{
        String target="nutstore".equals(next.optString("provider"))?NutstoreClient.target(next):ossTarget(config());File store=new File(directory(),"reader-store.json");
        if(store.exists()){
            byte[] previous=read(new AtomicFile(store).openRead(),128L*1024*1024);JSONObject bundle=new JSONObject(new String(previous,StandardCharsets.UTF_8)),sync=bundle.optJSONObject("sync");
            if(sync!=null&&!sync.optString("target").isEmpty()&&!sync.optString("target").equals(target)){
                if(!canCorrectUnconfirmedSync(sync))throw new Exception("这套资料已有云端历史，请在连接设置中选择「更换资料库」");
                atomic(new File(directory(),"reader-previous.json"),previous);sync.put("target","").put("enabled",false);bundle.put("syncRevision",bundle.optLong("syncRevision",0)+1);atomic(store,bundle.toString().getBytes(StandardCharsets.UTF_8));
            }
        }
        if(verification!=null)next.put("checkedTarget",target).put("checkedAt",java.time.Instant.now().toString()).put("remoteHasData",verification.getJSONArray("keys").length()>0);
        saveConnection(next);return syncIdentity();
    }
    @PluginMethod public void setSyncConnection(PluginCall call){run(disk,call,()->applyConnection(candidate(call.getObject("config")),null));}
    @PluginMethod public void connectSync(PluginCall call){network.execute(()->{try{
        JSONObject next=candidate(call.getObject("config"));String target="nutstore".equals(next.optString("provider"))?NutstoreClient.target(next):ossTarget(config());
        File store=new File(directory(),"reader-store.json");if(store.exists()){JSONObject sync=new JSONObject(new String(read(new AtomicFile(store).openRead(),128L*1024*1024),StandardCharsets.UTF_8)).optJSONObject("sync");if(sync!=null&&!sync.optString("target").isEmpty()&&!target.equals(sync.optString("target"))&&!canCorrectUnconfirmedSync(sync))throw new Exception("这套资料已有云端历史，请先更换资料库");}
        JSONObject check="nutstore".equals(next.optString("provider"))?new NutstoreClient(next).remote(new JSONObject().put("action","check")):ossRemote(config(),new JSONObject().put("action","check"));
        run(disk,call,()->applyConnection(next,check));
    }catch(Exception error){call.reject(error.getMessage());}});}
    private JSONObject fileDigest(File file)throws Exception{MessageDigest digest=MessageDigest.getInstance("SHA-256");long size=0;try(InputStream in=new FileInputStream(file)){byte[] buffer=new byte[65536];int n;while((n=in.read(buffer))!=-1){size+=n;digest.update(buffer,0,n);}}return new JSONObject().put("size",size).put("sha256",hex(digest.digest()));}
    @PluginMethod public void detachSync(PluginCall call){run(disk,call,()->{
        File store=new File(directory(),"reader-store.json");byte[] before=read(new AtomicFile(store).openRead(),128L*1024*1024);JSONObject bundle=new JSONObject(new String(before,StandardCharsets.UTF_8)),sync=bundle.optJSONObject("sync");
        if(!call.getString("target","").equals(sync==null?"":sync.optString("target")))throw new Exception("同步状态刚发生变化，请重新打开连接设置");
        JSONArray shelf=bundle.getJSONObject("data").getJSONArray("libraryBooks"),books=new JSONArray();Set<String> names=new HashSet<>();
        for(int i=0;i<shelf.length();i++){JSONObject book=shelf.getJSONObject(i);String name=book.optString("storedFile");if("reference".equals(book.optString("format"))&&name.isEmpty())continue;File file=bookFile(name);if(!file.isFile())throw new Exception("《"+book.optString("title")+"》本机没有原文件，请先下载，再更换资料库");if(names.add(name))books.put(fileDigest(file).put("storedFile",name));}
        byte[] drafts=new JSONObject().put("drafts",bundle.optJSONObject("drafts")==null?new JSONObject():bundle.getJSONObject("drafts")).toString().getBytes(StandardCharsets.UTF_8);
        JSONObject manifest=new JSONObject().put("format","wenjian-complete-backup").put("version",1).put("createdAt",java.time.Instant.now().toString()).put("notebook",new JSONObject().put("size",before.length).put("sha256",hex(hash(before)))).put("drafts",new JSONObject().put("size",drafts.length).put("sha256",hex(hash(drafts)))).put("books",books);
        File backupDir=new File(directory(),"restore-safeguards");if(!backupDir.exists()&&!backupDir.mkdirs())throw new IOException("无法创建备份目录");File destination=new File(backupDir,"更换同步资料库-"+System.currentTimeMillis()+".wenjian-backup"),partial=new File(destination+".partial");
        try{try(FileOutputStream file=new FileOutputStream(partial);DataOutputStream out=new DataOutputStream(file)){byte[] metadata=manifest.toString().getBytes(StandardCharsets.UTF_8);out.write("WENJIAN_BACKUP_V1\n".getBytes(StandardCharsets.US_ASCII));out.writeLong(metadata.length);out.write(metadata);out.write(before);out.write(drafts);
            for(int i=0;i<books.length();i++){JSONObject book=books.getJSONObject(i);MessageDigest digest=MessageDigest.getInstance("SHA-256");long size=0;try(InputStream in=new FileInputStream(bookFile(book.getString("storedFile")))){byte[] buffer=new byte[65536];int n;while((n=in.read(buffer))!=-1){out.write(buffer,0,n);digest.update(buffer,0,n);size+=n;}}if(size!=book.getLong("size")||!hex(digest.digest()).equals(book.getString("sha256")))throw new IOException("备份期间书籍发生变化，请重试");}out.flush();file.getFD().sync();}
            if(!partial.renameTo(destination))throw new IOException("备份保存失败");
            File credentials=new File(directory(),"sync-connection-secure.json");if(credentials.exists())atomic(new File(destination+".connection.json"),read(new AtomicFile(credentials).openRead(),65536));
            for(int i=0;i<shelf.length();i++)shelf.getJSONObject(i).remove("cloudFile");bundle.put("version",bundle.getLong("version")+1).put("syncRevision",bundle.optLong("syncRevision",0)+1).put("sync",new JSONObject().put("schema",1).put("device",UUID.randomUUID().toString()).put("enabled",false).put("target","").put("operations",new JSONArray()).put("pending",new JSONArray()).put("received",new JSONArray()).put("published",new JSONArray()).put("observed",new JSONObject()));
            atomic(new File(directory(),"reader-previous.json"),before);atomic(store,bundle.toString().getBytes(StandardCharsets.UTF_8));saveConnection(new JSONObject().put("provider",connectionConfig().optString("provider","nutstore")));return new JSObject().put("backupPath",destination.getAbsolutePath()).put("identity",syncIdentity());
        }finally{partial.delete();}
    });}
    private NutstoreClient nutstore(String requestedTarget)throws Exception{
        JSONObject connection=connectionConfig();if(!"nutstore".equals(connection.optString("provider")))return null;
        if(requestedTarget!=null&&!requestedTarget.equals(NutstoreClient.target(connection)))throw new Exception("同步位置已改变，本次传输取消");return new NutstoreClient(connection);
    }

    private static Map<String,String> map(String... pairs){Map<String,String> result=new TreeMap<>();for(int i=0;i<pairs.length;i+=2)result.put(pairs[i],pairs[i+1]);return result;}
    private static String hex(byte[] bytes){StringBuilder out=new StringBuilder();for(byte b:bytes)out.append(String.format(Locale.ROOT,"%02x",b));return out.toString();}
    private static byte[] hash(byte[] bytes)throws Exception{return MessageDigest.getInstance("SHA-256").digest(bytes);}
    private static byte[] hmac(byte[] key,String text)throws Exception{Mac mac=Mac.getInstance("HmacSHA256");mac.init(new SecretKeySpec(key,"HmacSHA256"));return mac.doFinal(text.getBytes(StandardCharsets.UTF_8));}
    private static String encode(String value)throws Exception{return URLEncoder.encode(value,"UTF-8").replace("+","%20").replace("*","%2A").replace("%7E","~");}
    private static String pathEncode(String value)throws Exception{String[] parts=value.split("/",-1);for(int i=0;i<parts.length;i++)parts[i]=encode(parts[i]);return String.join("/",parts);}
    private static String query(Map<String,String> values)throws Exception{List<String> parts=new ArrayList<>();for(String k:new TreeSet<>(values.keySet()))parts.add(encode(k)+"="+encode(values.get(k)));return String.join("&",parts);}
    private HttpsURLConnection connection(JSONObject cfg,String method,String object,Map<String,String> params,Map<String,String> extra)throws Exception{
        String region=cfg.getString("region"),bucket=cfg.getString("bucket");SimpleDateFormat clock=new SimpleDateFormat("yyyyMMdd'T'HHmmss'Z'",Locale.US);clock.setTimeZone(TimeZone.getTimeZone("UTC"));String time=clock.format(new Date()),date=time.substring(0,8),scope=date+"/"+region+"/oss/aliyun_v4_request",qs=query(params);
        TreeMap<String,String> headers=new TreeMap<>(extra);headers.put("x-oss-date",time);headers.put("x-oss-content-sha256","UNSIGNED-PAYLOAD");String authorization=OssV4Signer.authorization(method,bucket,object,params,headers,region,cfg.getString("accessKeyId"),cfg.getString("accessKeySecret"),time);
        URL url=new URL("https://"+bucket+".oss-"+region+".aliyuncs.com/"+pathEncode(object)+(qs.isEmpty()?"":"?"+qs));HttpsURLConnection conn=(HttpsURLConnection)url.openConnection();conn.setInstanceFollowRedirects(false);conn.setConnectTimeout(15000);conn.setReadTimeout(120000);conn.setRequestMethod(method);for(Map.Entry<String,String> entry:headers.entrySet())conn.setRequestProperty(entry.getKey(),entry.getValue());conn.setRequestProperty("Authorization",authorization);return conn;
    }
    private void requireSuccess(HttpsURLConnection connection)throws Exception{int status=connection.getResponseCode();if(status<200||status>=300)throw new IOException(status==403?"OSS 拒绝访问，请检查权限或设备时间":"OSS 请求失败（"+status+"）");}
    private String object(JSONObject cfg,String relative)throws Exception{if(relative==null||!relative.matches("(changes/[a-f0-9]{64}\\.json|books/[a-f0-9]{64}\\.(pdf|epub))"))throw new Exception("同步对象名称无效");return cfg.getString("prefix")+"sync-v1/"+relative;}
    private static String xml(String value,String tag){java.util.regex.Matcher match=java.util.regex.Pattern.compile("<"+tag+">([\\s\\S]*?)</"+tag+">").matcher(value);return match.find()?match.group(1).replace("&lt;","<").replace("&gt;",">").replace("&quot;","\"").replace("&apos;","'").replace("&amp;","&"):null;}
    @PluginMethod public void remote(PluginCall call){run(network,call,()->{NutstoreClient dav=nutstore(call.getString("target"));if(dav!=null)return JSObject.fromJSONObject(dav.remote(call.getData()));JSONObject cfg=config();if(cfg==null)throw new Exception("请先填写 OSS 设置");String requestedTarget=call.getString("target");if(requestedTarget!=null&&!requestedTarget.equals(cfg.getString("region")+"/"+cfg.getString("bucket")+"/"+cfg.getString("prefix")))throw new Exception("同步位置已改变，本次传输取消");return ossRemote(cfg,call.getData());});}
    private JSObject ossRemote(JSONObject cfg,JSONObject input)throws Exception{String action=input.optString("action"),relative=input.optString("key");
        if("check".equals(action)){
            byte[] probe="{\"schema\":1,\"purpose\":\"wenjian-connection-check\"}".getBytes(StandardCharsets.UTF_8);String key=cfg.getString("prefix")+"sync-v1/connection-check.json";
            HttpsURLConnection put=connection(cfg,"PUT",key,map(),map("content-type","application/json","x-oss-forbid-overwrite","true"));try{put.setDoOutput(true);put.setFixedLengthStreamingMode(probe.length);try(OutputStream out=put.getOutputStream()){out.write(probe);}if(put.getResponseCode()!=409)requireSuccess(put);}finally{put.disconnect();}
            HttpsURLConnection get=connection(cfg,"GET",key,map(),map());try{requireSuccess(get);if(!Arrays.equals(probe,read(get.getInputStream(),65536)))throw new IOException("连接检查文件不一致");}finally{get.disconnect();}
            return ossRemote(cfg,new JSONObject().put("action","list")).put("ok",true);
        }
        if("list".equals(action)){JSONArray keys=new JSONArray();String token=null,prefix=cfg.getString("prefix")+"sync-v1/";do{Map<String,String> params=new TreeMap<>();params.put("list-type","2");params.put("prefix",prefix+"changes/");params.put("max-keys","1000");if(token!=null)params.put("continuation-token",token);HttpsURLConnection conn=connection(cfg,"GET","",params,map());String response;try{requireSuccess(conn);response=new String(read(conn.getInputStream(),16L*1024*1024),StandardCharsets.UTF_8);}finally{conn.disconnect();}java.util.regex.Matcher matcher=java.util.regex.Pattern.compile("<Key>([\\s\\S]*?)</Key>").matcher(response);while(matcher.find()){String key=xml(matcher.group(),"Key");if(key!=null&&key.startsWith(prefix)){String r=key.substring(prefix.length());object(cfg,r);keys.put(r);}}String next=xml(response,"NextContinuationToken");if("true".equals(xml(response,"IsTruncated"))&&(next==null||next.equals(token)))throw new IOException("同步目录分页失败");token="true".equals(xml(response,"IsTruncated"))?next:null;}while(token!=null);return new JSObject().put("keys",keys);}
        String key=object(cfg,relative);if(!relative.startsWith("changes/"))throw new Exception("请使用书籍传输接口");boolean put="put".equals(action);if(!put&&!"get".equals(action))throw new Exception("不支持的操作");byte[] body=put? input.optString("text").getBytes(StandardCharsets.UTF_8):null;
        if(put&&(body.length>16*1024*1024||!relative.equals("changes/"+hex(hash(body))+".json")))throw new Exception("同步文件校验不正确");HttpsURLConnection conn=connection(cfg,put?"PUT":"GET",key,map(),put?map("content-type","application/json","x-oss-forbid-overwrite","true"):map());try{if(put){conn.setDoOutput(true);conn.setFixedLengthStreamingMode(body.length);try(OutputStream out=conn.getOutputStream()){out.write(body);}if(conn.getResponseCode()==409){HttpsURLConnection existing=connection(cfg,"GET",key,map(),map());try{requireSuccess(existing);if(!Arrays.equals(body,read(existing.getInputStream(),16L*1024*1024)))throw new IOException("云端文件校验失败");}finally{existing.disconnect();}return new JSObject().put("ok",true);}}requireSuccess(conn);return put?new JSObject().put("ok",true):new JSObject().put("text",new String(read(conn.getInputStream(),16L*1024*1024),StandardCharsets.UTF_8));}finally{conn.disconnect();}
    }
    @PluginMethod public void transferBook(PluginCall call){run(network,call,()->{NutstoreClient dav=nutstore(call.getString("target"));if(dav!=null){File local=bookFile(call.getString("name"));String operation=call.getString("action");if("upload".equals(operation))return JSObject.fromJSONObject(dav.upload(local));if("download".equals(operation))return JSObject.fromJSONObject(dav.download(call.getObject("file"),local));throw new Exception("不支持的传输操作");}JSONObject cfg=config();if(cfg==null)throw new Exception("请先填写 OSS 设置");String requested=call.getString("target");if(requested!=null&&!requested.equals(cfg.getString("region")+"/"+cfg.getString("bucket")+"/"+cfg.getString("prefix")))throw new Exception("同步位置已改变，本次传输取消");File file=bookFile(call.getString("name"));String action=call.getString("action");
        if("upload".equals(action)){if(!file.isFile())throw new Exception("本机没有这本书");MessageDigest digest=MessageDigest.getInstance("SHA-256");try(InputStream in=new FileInputStream(file)){byte[] buffer=new byte[65536];int n;while((n=in.read(buffer))!=-1)digest.update(buffer,0,n);}String sha=hex(digest.digest()),format=file.getName().endsWith(".pdf")?"pdf":"epub",relative="books/"+sha+"."+format;HttpsURLConnection conn=connection(cfg,"PUT",object(cfg,relative),map(),map("content-type","application/octet-stream","x-oss-forbid-overwrite","true","x-oss-meta-wenjian-sha256",sha));try{conn.setDoOutput(true);conn.setFixedLengthStreamingMode(file.length());try(InputStream in=new FileInputStream(file);OutputStream out=conn.getOutputStream()){byte[] buffer=new byte[65536];int n;while((n=in.read(buffer))!=-1)out.write(buffer,0,n);}if(conn.getResponseCode()==409){HttpsURLConnection existing=connection(cfg,"HEAD",object(cfg,relative),map(),map());try{requireSuccess(existing);if(!Long.toString(file.length()).equals(existing.getHeaderField("Content-Length"))||!sha.equals(existing.getHeaderField("x-oss-meta-wenjian-sha256")))throw new IOException("云端书籍校验信息不一致");}finally{existing.disconnect();}}else requireSuccess(conn);}finally{conn.disconnect();}return new JSObject().put("key",relative).put("sha256",sha).put("size",file.length());}
        if(!"download".equals(action))throw new Exception("不支持的传输操作");JSONObject manifest=call.getObject("file");String relative=manifest.getString("key"),expected=manifest.getString("sha256");long size=manifest.getLong("size");if(size<1||size>5L*1024*1024*1024||!expected.matches("[a-f0-9]{64}")||!(relative.equals("books/"+expected+".pdf")||relative.equals("books/"+expected+".epub")))throw new Exception("书籍清单无效");File partial=new File(directory(),"download-"+UUID.randomUUID());HttpsURLConnection conn=connection(cfg,"GET",object(cfg,relative),map(),map());MessageDigest digest=MessageDigest.getInstance("SHA-256");long total=0;try{requireSuccess(conn);try(InputStream in=conn.getInputStream();FileOutputStream out=new FileOutputStream(partial)){byte[] buffer=new byte[65536];int n;while((n=in.read(buffer))!=-1){total+=n;if(total>size)throw new IOException("下载超过预期大小");digest.update(buffer,0,n);out.write(buffer,0,n);}out.getFD().sync();}if(total!=size||!hex(digest.digest()).equals(expected))throw new IOException("书籍下载校验失败");if(!partial.renameTo(file))throw new IOException("下载文件保存失败");return new JSObject().put("ok",true);}finally{conn.disconnect();partial.delete();}
    });}
}
