package com.wenjian.reader;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/** Identical OSS v4 canonicalization on desktop and Android; no secrets are logged. */
public final class OssV4Signer {
    private OssV4Signer() {}
    private static byte[] hmac(byte[] key,String value)throws Exception{Mac mac=Mac.getInstance("HmacSHA256");mac.init(new SecretKeySpec(key,"HmacSHA256"));return mac.doFinal(value.getBytes(StandardCharsets.UTF_8));}
    private static String hex(byte[] bytes){StringBuilder text=new StringBuilder();for(byte value:bytes)text.append(String.format(Locale.ROOT,"%02x",value));return text.toString();}
    private static String encode(String value)throws Exception{return URLEncoder.encode(value,"UTF-8").replace("+","%20").replace("*","%2A").replace("%7E","~");}
    private static String path(String value)throws Exception{String[] parts=value.split("/",-1);for(int i=0;i<parts.length;i++)parts[i]=encode(parts[i]);return String.join("/",parts);}
    public static String authorization(String method,String bucket,String object,Map<String,String> query,Map<String,String> headers,String region,String id,String secret,String timestamp)throws Exception{
        String date=timestamp.substring(0,8),scope=date+"/"+region+"/oss/aliyun_v4_request";
        List<String> params=new ArrayList<>();for(String key:new TreeSet<>(query.keySet()))params.add(encode(key)+"="+encode(query.get(key)));
        StringBuilder canonicalHeaders=new StringBuilder();List<String> additional=new ArrayList<>();TreeMap<String,String> normalized=new TreeMap<>();for(Map.Entry<String,String> e:headers.entrySet())normalized.put(e.getKey().toLowerCase(Locale.ROOT),e.getValue().trim());
        for(String key:normalized.keySet()){if(key.equals("content-length")||key.equals("content-disposition"))additional.add(key);if(key.startsWith("x-oss-")||key.equals("content-type")||key.equals("content-md5")||additional.contains(key))canonicalHeaders.append(key).append(':').append(normalized.get(key)).append('\n');}
        String names=String.join(";",additional),canonical=method+"\n"+path("/"+bucket+"/"+object)+"\n"+String.join("&",params)+"\n"+canonicalHeaders+"\n"+names+"\nUNSIGNED-PAYLOAD";
        String digest=hex(MessageDigest.getInstance("SHA-256").digest(canonical.getBytes(StandardCharsets.UTF_8)));
        byte[] key=hmac(hmac(hmac(hmac(("aliyun_v4"+secret).getBytes(StandardCharsets.UTF_8),date),region),"oss"),"aliyun_v4_request");
        String signature=hex(hmac(key,"OSS4-HMAC-SHA256\n"+timestamp+"\n"+scope+"\n"+digest));
        return "OSS4-HMAC-SHA256 Credential="+id+"/"+scope+(names.isEmpty()?"":",AdditionalHeaders="+names)+",Signature="+signature;
    }
}
