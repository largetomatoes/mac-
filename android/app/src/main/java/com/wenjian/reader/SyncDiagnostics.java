package com.wenjian.reader;
import android.content.Context;
import android.util.AtomicFile;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/** Local task tokens and bounded diagnostics; no note text, URLs or credentials. */
final class SyncDiagnostics {
 static final String PROCESS=UUID.randomUUID().toString();
 private static boolean installed=false;private static byte[] reserve=new byte[32768];
 private static File file(Context c,String name){return new File(c.getFilesDir(),name);}
 static synchronized void install(Context c){if(installed)return;installed=true;final Context app=c.getApplicationContext();final Thread.UncaughtExceptionHandler previous=Thread.getDefaultUncaughtExceptionHandler();Thread.setDefaultUncaughtExceptionHandler((thread,error)->{reserve=null;try{hold(app,true);failure(app,"uncaught",error);}catch(Throwable ignored){}finally{if(previous!=null)previous.uncaughtException(thread,error);else{android.os.Process.killProcess(android.os.Process.myPid());System.exit(10);}}});}
 static synchronized void event(Context c,String stage,String kind){try{File f=file(c,"sync-diagnostics.jsonl");if(f.length()>128*1024){File old=file(c,"sync-diagnostics-previous.jsonl");old.delete();f.renameTo(old);}try(FileOutputStream out=new FileOutputStream(f,true)){JSONObject row=new JSONObject().put("at",java.time.Instant.now().toString()).put("stage",stage).put("kind",kind).put("heapUsed",Runtime.getRuntime().totalMemory()-Runtime.getRuntime().freeMemory()).put("heapMax",Runtime.getRuntime().maxMemory());out.write((row.toString()+"\n").getBytes(StandardCharsets.UTF_8));}}catch(Exception ignored){}}
 static void failure(Context c,String stage,Throwable error){event(c,stage,error.getClass().getName());try{for(int i=0;i<Math.min(10,error.getStackTrace().length);i++){StackTraceElement e=error.getStackTrace()[i];event(c,"frame",e.getClassName()+"."+e.getMethodName()+":"+e.getLineNumber());}}catch(Throwable ignored){}}
 static void hold(Context c,boolean value){c.getSharedPreferences("sync-recovery",0).edit().putBoolean("hold",value).commit();}
 static boolean held(Context c){return c.getSharedPreferences("sync-recovery",0).getBoolean("hold",false)||interrupted(c);}
 private static JSONObject journal(Context c)throws Exception{File f=file(c,"sync-task-local.json");if(!f.exists())return new JSONObject();try(InputStream in=new AtomicFile(f).openRead();ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1){if(out.size()+n>32768)throw new IOException("本机同步任务记录过大");out.write(b,0,n);}return new JSONObject(out.toString("UTF-8"));}}
 private static void save(Context c,JSONObject value)throws Exception{AtomicFile f=new AtomicFile(file(c,"sync-task-local.json"));FileOutputStream out=null;try{out=f.startWrite();out.write(value.toString().getBytes(StandardCharsets.UTF_8));f.finishWrite(out);}catch(Exception e){if(out!=null)f.failWrite(out);throw e;}}
 static boolean interrupted(Context c){try{JSONObject j=journal(c);return !j.optString("owner").isEmpty()&&!PROCESS.equals(j.optString("process"));}catch(Exception e){return true;}}
 static synchronized JSONObject begin(Context c,String target,String owner)throws Exception{
  if(target==null||target.length()>2048||owner==null||!owner.matches("[a-zA-Z0-9_-]{8,100}"))throw new IOException("同步任务标识无效");
  JSONObject old=journal(c);JSONArray recover=new JSONArray();boolean same=target.equals(old.optString("target"));
  if(same&&!old.optString("owner").isEmpty()&&PROCESS.equals(old.optString("process"))&&!old.optBoolean("ended"))throw new IOException("本机已有同步任务正在处理，请稍后重试");
  if(same){JSONArray list=old.optJSONArray("recoverable");if(list!=null)for(int i=Math.max(0,list.length()-6);i<list.length();i++)recover.put(list.getString(i));if(!old.optString("owner").isEmpty())recover.put(old.getString("owner"));}
  save(c,new JSONObject().put("owner",owner).put("target",target).put("process",PROCESS).put("ended",false).put("recoverable",recover));event(c,"sync","begin");
  return new JSONObject().put("recoverableOwners",recover).put("deviceName",android.os.Build.MANUFACTURER+" "+android.os.Build.MODEL);
 }
 static synchronized void end(Context c,String target,String owner,boolean released,boolean succeeded)throws Exception{JSONObject j=journal(c);if(!target.equals(j.optString("target"))||!owner.equals(j.optString("owner")))return;j.put("ended",true);if(released)j.put("owner","").put("recoverable",new JSONArray());save(c,j);if(succeeded)hold(c,false);event(c,"sync",succeeded?"finished":"interrupted");}
 static File export(Context c)throws Exception{File dir=new File(c.getCacheDir(),"sync-diagnostics");if(!dir.exists()&&!dir.mkdirs())throw new IOException("无法创建诊断文件");File target=new File(dir,"Wenjian-sync-diagnostics.txt");try(FileOutputStream out=new FileOutputStream(target)){android.content.pm.PackageInfo info=c.getPackageManager().getPackageInfo(c.getPackageName(),0);String header="Wenjian Android diagnostics\nBuild: "+info.versionName+" ("+(android.os.Build.VERSION.SDK_INT>=28?info.getLongVersionCode():info.versionCode)+")\nDevice: "+android.os.Build.MANUFACTURER+" "+android.os.Build.MODEL+"\nAndroid API: "+android.os.Build.VERSION.SDK_INT+"\nHeap limit: "+Runtime.getRuntime().maxMemory()+"\n";out.write(header.getBytes(StandardCharsets.UTF_8));for(String name:new String[]{"sync-diagnostics-previous.jsonl","sync-diagnostics.jsonl"}){File f=file(c,name);if(f.exists())try(InputStream in=new FileInputStream(f)){byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1)out.write(b,0,n);}}}return target;}
}
