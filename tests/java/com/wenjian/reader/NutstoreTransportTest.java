package com.wenjian.reader;
import okhttp3.*;
import okio.Buffer;
import org.json.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;

public class NutstoreTransportTest {
    static String hex(byte[] bytes){StringBuilder out=new StringBuilder();for(byte b:bytes)out.append(String.format("%02x",b));return out.toString();}
    static String xml(List<String> paths){StringBuilder out=new StringBuilder("<d:multistatus xmlns:d=\"DAV:\">");for(String p:paths)out.append("<d:response><d:href>").append(p).append("</d:href><d:propstat><d:prop/><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>");return out.append("</d:multistatus>").toString();}
    static String digest(byte[] bytes){try{return hex(MessageDigest.getInstance("SHA-256").digest(bytes));}catch(Exception e){throw new AssertionError(e);}}
    static void check(boolean condition){if(!condition)throw new AssertionError();}
    public static void main(String[] args)throws Exception {
        Map<String,byte[]> files=new HashMap<>();Set<String> folders=new HashSet<>();String base="/dav/问间资料库/sync-v1/";boolean[] corrupt={false};
        OkHttpClient http=new OkHttpClient.Builder().addInterceptor(chain->{Request request=chain.request();check(request.url().host().equals("dav.jianguoyun.com"));check(request.header("Authorization").equals(Credentials.basic("qa@example.invalid","synthetic-password",StandardCharsets.UTF_8)));String p="/"+String.join("/",request.url().pathSegments());check(p.startsWith("/dav/问间资料库/"));int status=200;byte[] body=new byte[0];Response.Builder response=new Response.Builder().protocol(Protocol.HTTP_1_1).request(request).message("test");
            switch(request.method()){
            case "MKCOL":status=folders.add(p)?201:405;break;
            case "PROPFIND":check("1".equals(request.header("Depth")));if(!folders.contains(p)){status=404;break;}List<String> paths=new ArrayList<>();paths.add(p);for(String key:folders)if(!key.equals(p)&&key.startsWith(p)&&!key.substring(p.length()).replaceAll("/$","").contains("/"))paths.add(key);for(String key:files.keySet())if(key.startsWith(p)&&!key.substring(p.length()).contains("/"))paths.add(key);body=xml(paths).getBytes(StandardCharsets.UTF_8);status=207;break;
            case "PUT":String etag=request.header("If-Match");if(etag!=null){if(!files.containsKey(p)||!etag.equals("\""+digest(files.get(p))+"\"")){status=412;break;}}else if(request.header("If-None-Match")!=null){check("*".equals(request.header("If-None-Match")));if(files.containsKey(p)){status=412;break;}}Buffer buffer=new Buffer();request.body().writeTo(buffer);files.put(p,buffer.readByteArray());status=201;break;
            case "HEAD":if(!files.containsKey(p)){status=404;break;}response.header("Content-Length",Integer.toString(files.get(p).length));break;
            case "GET":if(!files.containsKey(p)){status=404;break;}body=corrupt[0]?"broken".getBytes(StandardCharsets.UTF_8):files.get(p);response.header("ETag","\""+digest(body)+"\"");break;
            case "DELETE":status=files.remove(p)==null?404:204;break;
            default:throw new AssertionError("unknown method");}
            return response.code(status).body(ResponseBody.create(body,MediaType.get("application/octet-stream"))).build();
        }).build();
        JSONObject config=NutstoreClient.validate(new JSONObject().put("username","QA@example.invalid").put("password","synthetic-password"),"");NutstoreClient client=new NutstoreClient(config,http);
        check(NutstoreClient.children(xml(Arrays.asList(base,base+"a")).replace("<d:prop/>","<d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop>"),base).equals(Arrays.asList("a/")));
        String text="{\"schema\":1,\"operations\":[]}",key="changes/"+hex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)))+".json";
        JSONObject put=new JSONObject().put("action","put").put("key",key).put("text",text);client.remote(put);client.remote(put);check(files.size()==1);check(client.remote(new JSONObject().put("action","list")).getJSONArray("keys").getString(0).equals(key));check(client.remote(new JSONObject().put("action","get").put("key",key)).getString("text").equals(text));
        JSONObject missing=client.remote(new JSONObject().put("action","control-get").put("key","library.json"));check(missing.isNull("text"));
        JSONObject control=new JSONObject().put("action","control-put").put("key","library.json").put("text","{\"schema\":1}");client.remote(control);
        JSONObject info=client.remote(new JSONObject().put("action","control-get").put("key","library.json"));check(info.getString("text").equals("{\"schema\":1}"));
        boolean stale=false;try{client.remote(control);}catch(Exception expected){stale=true;}check(stale);
        client.remote(new JSONObject(control.toString()).put("etag",info.getString("etag")).put("text","{\"schema\":2}"));
        String epoch="virtual-epoch-0001",epochKey="epochs/"+epoch+"/"+key,snapshotKey=key.replace("changes/","snapshots/");
        client.remote(new JSONObject(put.toString()).put("key",epochKey));client.remote(new JSONObject(put.toString()).put("key",snapshotKey));
        check(client.remote(new JSONObject().put("action","list").put("epoch",epoch)).getJSONArray("keys").getString(0).equals(epochKey));
        check(client.remote(new JSONObject().put("action","get").put("key",snapshotKey)).getString("text").equals(text));
        client.remote(new JSONObject().put("action","guard"));check(client.remote(new JSONObject().put("action","list")).getJSONArray("keys").length()==1);
        client.remote(new JSONObject().put("action","delete").put("key",epochKey));check(client.remote(new JSONObject().put("action","list").put("epoch",epoch)).getJSONArray("keys").length()==0);
        boolean escaped=false;try{client.remote(new JSONObject().put("action","delete").put("key","books/"+"a".repeat(64)+".pdf"));}catch(Exception expected){escaped=true;}check(escaped);
        Path dir=Files.createTempDirectory("wenjian-java-test-");try{Path source=dir.resolve("fixture.pdf"),target=dir.resolve("download.pdf");byte[] original="%PDF-1.7\nsynthetic".getBytes(StandardCharsets.UTF_8);Files.write(source,original);JSONObject manifest=client.upload(source.toFile());client.upload(source.toFile());client.download(manifest,target.toFile());check(Arrays.equals(Files.readAllBytes(target),original));corrupt[0]=true;boolean rejected=false;try{client.download(manifest,target.toFile());}catch(Exception expected){rejected=true;}check(rejected);check(Arrays.equals(Files.readAllBytes(target),original));try(var paths=Files.list(dir)){check(paths.count()==2);}}finally{try(var paths=Files.list(dir)){for(Path p:paths.toList())Files.delete(p);}Files.delete(dir);}
        boolean rejected=false;try{NutstoreClient.children(xml(Collections.nCopies(750,base+"a")),base);}catch(Exception expected){rejected=true;}check(rejected);
        System.out.println("PASS: Android Nutstore transport compiles; immutable deltas, folder confinement, book retries, hash verification and truncated listings");
    }
}
