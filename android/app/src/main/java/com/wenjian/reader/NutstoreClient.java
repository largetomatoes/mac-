package com.wenjian.reader;

import okhttp3.*;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.regex.*;

/** Nutstore transport. Only the dedicated Wenjian directory is addressable. */
final class NutstoreClient {
    private static final String ROOT="/dav/问间资料库/sync-v1/";
    private static final long MAX_BOOK=500_000_000L;
    private static final OkHttpClient HTTP=new OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
        .connectTimeout(15,TimeUnit.SECONDS).readTimeout(120,TimeUnit.SECONDS).writeTimeout(120,TimeUnit.SECONDS).build();
    private final String authorization;
    private final OkHttpClient http;
    private final Set<String> ensured=new HashSet<>();
    NutstoreClient(JSONObject config)throws Exception {this(config,HTTP);}
    NutstoreClient(JSONObject config,OkHttpClient http)throws Exception {this.http=http; authorization=Credentials.basic(config.getString("username"),config.getString("password"),StandardCharsets.UTF_8); }
    static String target(JSONObject config)throws Exception {return "nutstore/"+config.getString("username").toLowerCase(Locale.ROOT)+"/问间资料库/";}
    static JSONObject validate(JSONObject input,String previousPassword)throws Exception {
        String username=input.optString("username").trim().toLowerCase(Locale.ROOT),password=input.optString("password");
        if(password.isEmpty())password=previousPassword;
        if(!username.matches("[^\\s:@]+@[^\\s:@]+\\.[^\\s:@]+")||username.length()>254||password.length()<4||password.length()>256||password.contains("\r")||password.contains("\n"))throw new IOException("请填写坚果云邮箱和应用密码");
        return new JSONObject().put("username",username).put("password",password);
    }
    private static String object(String key)throws Exception {
        if(key==null||!key.matches("(changes/[a-f0-9]{64}\\.json|books/[a-f0-9]{64}\\.(pdf|epub))"))throw new IOException("同步文件名无效");
        return ROOT+(key.startsWith("changes/")?"changes/"+key.charAt(8)+"/"+key.substring(8):key);
    }
    private Response request(String method,String path,RequestBody body,String...headers)throws Exception {
        HttpUrl.Builder url=new HttpUrl.Builder().scheme("https").host("dav.jianguoyun.com");
        String[] parts=path.substring(1).split("/",-1);for(String part:parts)url.addPathSegment(part);
        Request.Builder request=new Request.Builder().url(url.build()).header("Authorization",authorization).method(method,body);
        for(int i=0;i<headers.length;i+=2)request.header(headers[i],headers[i+1]);return http.newCall(request.build()).execute();
    }
    private static void success(Response response)throws IOException {
        if(response.isSuccessful())return;int code=response.code();throw new IOException(code==401?"坚果云身份验证失败（401），请检查账号邮箱和第三方应用密码":code==403?"坚果云拒绝访问（403），请检查应用授权或目录权限；这不一定是密码错误":code==429?"坚果云请求过于频繁，请稍后重试":code==507?"坚果云空间或流量不足":"坚果云请求失败（"+code+"）");
    }
    private static byte[] read(InputStream stream,long max)throws Exception {
        try(InputStream in=stream;ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] buffer=new byte[65536];long total=0;int n;while((n=in.read(buffer))!=-1){total+=n;if(total>max)throw new IOException("同步响应过大");out.write(buffer,0,n);}return out.toByteArray();}
    }
    private void ensure(String key)throws Exception {
        List<String> paths=new ArrayList<>(Arrays.asList("/dav/问间资料库/",ROOT,ROOT+"changes/",ROOT+"books/"));
        if(key!=null&&key.startsWith("changes/"))paths.add(ROOT+"changes/"+key.charAt(8)+"/");
        for(String path:paths){if(ensured.contains(path))continue;try(Response r=request("MKCOL",path,null)){if(r.code()!=405)success(r);}ensured.add(path);}
    }
    private static String decodeXml(String value) {
        Matcher matcher=Pattern.compile("&#(x[0-9a-fA-F]+|[0-9]+);").matcher(value);StringBuffer output=new StringBuffer();
        while(matcher.find()){String n=matcher.group(1);int cp=n.startsWith("x")?Integer.parseInt(n.substring(1),16):Integer.parseInt(n);matcher.appendReplacement(output,Matcher.quoteReplacement(new String(Character.toChars(cp))));}matcher.appendTail(output);
        return output.toString().replace("&lt;","<").replace("&gt;",">").replace("&quot;","\"").replace("&apos;","'").replace("&amp;","&");
    }
    static List<String> children(String xml,String folder)throws Exception {
        if(!Pattern.compile("<(?:[\\w-]+:)?multistatus[\\s>]").matcher(xml).find()||!Pattern.compile("</(?:[\\w-]+:)?multistatus>").matcher(xml).find()||Pattern.compile("<!DOCTYPE|<!ENTITY",Pattern.CASE_INSENSITIVE).matcher(xml).find())throw new IOException("坚果云目录响应不完整");
        Matcher blocks=Pattern.compile("<(?:[\\w-]+:)?response[\\s>]([\\s\\S]*?)</(?:[\\w-]+:)?response>").matcher(xml);List<String> result=new ArrayList<>();int count=0;
        while(blocks.find()){
            if(++count>=750)throw new IOException("坚果云目录达到单次读取上限，已暂停同步");
            Matcher href=Pattern.compile("<(?:[\\w-]+:)?href[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?href>").matcher(blocks.group(1));
            if(!href.find())throw new IOException("目录缺少文件地址");URI uri=new URI("https://dav.jianguoyun.com").resolve(decodeXml(href.group(1)));
            if(!"https".equals(uri.getScheme())||!"dav.jianguoyun.com".equals(uri.getHost())||uri.getPort()!=-1)throw new IOException("坚果云返回外部地址");String path=uri.getPath();
            if(!Pattern.compile("<(?:[\\w-]+:)?status[^>]*>HTTP/\\d(?:\\.\\d)? 2\\d\\d").matcher(blocks.group(1)).find())throw new IOException("坚果云文件状态读取失败");
            if(path.replaceAll("/$","").equals(folder.replaceAll("/$","")))continue;
            if(!path.startsWith(folder)||path.substring(folder.length()).replaceAll("/$","").contains("/"))throw new IOException("坚果云返回目录外文件");
String child=path.substring(folder.length());if(Pattern.compile("<(?:[\\w-]+:)?collection(?:\\s[^>]*)?/?[>]").matcher(blocks.group(1)).find()&&!child.endsWith("/"))child+="/";result.add(child);
        }if(count==0)throw new IOException("坚果云目录响应为空，未合并");return result;
    }
    private List<String> listing(String folder)throws Exception {
        String xml="<?xml version=\"1.0\"?><d:propfind xmlns:d=\"DAV:\"><d:prop><d:resourcetype/></d:prop></d:propfind>";
        try(Response response=request("PROPFIND",folder,RequestBody.create(xml,MediaType.get("application/xml")),"Depth","1")){if(response.code()==404)return Collections.emptyList();success(response);return children(new String(read(response.body().byteStream(),16L*1024*1024),StandardCharsets.UTF_8),folder);}
    }
    JSONObject remote(JSONObject input)throws Exception {
        String action=input.optString("action");
        if("check".equals(action)){
            ensure(null);byte[] probe="{\"schema\":1,\"purpose\":\"wenjian-connection-check\"}".getBytes(StandardCharsets.UTF_8);String path=ROOT+"connection-check.json";
            try(Response put=request("PUT",path,RequestBody.create(probe,MediaType.get("application/json")),"If-None-Match","*")){if(put.code()!=412)success(put);}
            try(Response get=request("GET",path,null)){success(get);if(!Arrays.equals(probe,read(get.body().byteStream(),65536)))throw new IOException("连接检查文件不一致");}
            return remote(new JSONObject().put("action","list")).put("ok",true);
        }
        if("list".equals(action)){JSONArray keys=new JSONArray();for(String dir:listing(ROOT+"changes/")){if(!dir.matches("[a-f0-9]/"))throw new IOException("同步目录含未知文件，未合并");for(String name:listing(ROOT+"changes/"+dir)){if(!name.matches(dir.charAt(0)+"[a-f0-9]{63}\\.json"))throw new IOException("同步文件名不正确");keys.put("changes/"+name);}}return new JSONObject().put("keys",keys);}
        String key=input.getString("key"),path=object(key);if(!key.startsWith("changes/"))throw new IOException("请使用书籍接口");
        if("get".equals(action)){try(Response response=request("GET",path,null)){success(response);return new JSONObject().put("text",new String(read(response.body().byteStream(),16L*1024*1024),StandardCharsets.UTF_8));}}
        byte[] body=input.optString("text").getBytes(StandardCharsets.UTF_8);if(!"put".equals(action)||body.length>16*1024*1024||!key.equals("changes/"+hex(MessageDigest.getInstance("SHA-256").digest(body))+".json"))throw new IOException("同步文件校验不正确");
        ensure(key);try(Response response=request("PUT",path,RequestBody.create(body,MediaType.get("application/json")),"If-None-Match","*")){if(response.code()==412){try(Response existing=request("GET",path,null)){success(existing);if(!Arrays.equals(body,read(existing.body().byteStream(),16L*1024*1024)))throw new IOException("云端文件校验失败");}}else success(response);}return new JSONObject().put("ok",true);
    }
    private static String hex(byte[] bytes){StringBuilder result=new StringBuilder();for(byte value:bytes)result.append(String.format(Locale.ROOT,"%02x",value));return result.toString();}
    JSONObject upload(File file)throws Exception {
        if(!file.isFile()||file.length()<1||file.length()>MAX_BOOK)throw new IOException("坚果云 WebDAV 单本书需小于 500 MB；笔记仍可同步");
        MessageDigest digest=MessageDigest.getInstance("SHA-256");try(InputStream in=new FileInputStream(file)){byte[] buffer=new byte[65536];int n;while((n=in.read(buffer))!=-1)digest.update(buffer,0,n);}String sha=hex(digest.digest()),key="books/"+sha+(file.getName().endsWith(".pdf")?".pdf":".epub");ensure(null);
        try(Response response=request("PUT",object(key),RequestBody.create(file,MediaType.get("application/octet-stream")),"If-None-Match","*")){if(response.code()==412){try(Response head=request("HEAD",object(key),null)){success(head);if(!Long.toString(file.length()).equals(head.header("Content-Length")))throw new IOException("云端书籍大小与本机不一致");}}else success(response);}return new JSONObject().put("key",key).put("sha256",sha).put("size",file.length());
    }
    JSONObject download(JSONObject manifest,File file)throws Exception {
        String sha=manifest.getString("sha256"),key=manifest.getString("key");long size=manifest.getLong("size");if(!sha.matches("[a-f0-9]{64}")||!(key.equals("books/"+sha+".pdf")||key.equals("books/"+sha+".epub"))||size<1||size>MAX_BOOK)throw new IOException("云端书籍清单无效");
        File partial=new File(file.getParentFile(),"download-"+UUID.randomUUID());MessageDigest digest=MessageDigest.getInstance("SHA-256");long total=0;
        try{try(Response response=request("GET",object(key),null)){success(response);try(InputStream in=response.body().byteStream();FileOutputStream out=new FileOutputStream(partial)){byte[] buffer=new byte[65536];int n;while((n=in.read(buffer))!=-1){total+=n;if(total>size)throw new IOException("下载超出预期大小");digest.update(buffer,0,n);out.write(buffer,0,n);}out.getFD().sync();}}
            if(total!=size||!hex(digest.digest()).equals(sha))throw new IOException("书籍校验失败，未替换本机文件");if(!partial.renameTo(file))throw new IOException("文件保存失败");return new JSONObject().put("ok",true);
        }finally{partial.delete();}
    }
}
