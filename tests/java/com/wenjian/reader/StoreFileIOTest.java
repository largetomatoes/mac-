package com.wenjian.reader;
import java.io.*;
import java.nio.file.*;
import java.util.Arrays;
import java.security.MessageDigest;
public final class StoreFileIOTest{
 static void check(boolean b,String message){if(!b)throw new AssertionError(message);}
 static byte[] digest(File f)throws Exception{MessageDigest d=MessageDigest.getInstance("SHA-256");try(InputStream in=new FileInputStream(f)){byte[] b=new byte[65536];int n;while((n=in.read(b))!=-1)d.update(b,0,n);}return d.digest();}
 public static void main(String[] args)throws Exception{
  Path dir=Files.createTempDirectory("wenjian-store-test-");File target=dir.resolve("store.json").toFile(),previous=dir.resolve("previous.json").toFile();Files.writeString(target.toPath(),"original");boolean[] fail={false};
  StoreFileIO io=new StoreFileIO(dir.resolve("staging").toFile(),()->new FileInputStream(target),file->{if(fail[0])throw new IOException("validation rejected");Files.copy(target.toPath(),previous.toPath(),StandardCopyOption.REPLACE_EXISTING);Files.move(file.toPath(),target.toPath(),StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);});
  String id=io.beginWrite();io.append(id,"unfinished");io.abort(id);check(Files.readString(target.toPath()).equals("original"),"aborting preserves original");
  id=io.beginWrite();io.append(id,"invalid");fail[0]=true;try{io.finish(id);throw new AssertionError("validation should fail");}catch(IOException expected){}check(Files.readString(target.toPath()).equals("original"),"failed validation preserves original");check(io.scratch.list().length==0,"failed stage removed");fail[0]=false;
  id=io.beginWrite();try{io.append("wrong-id","bad");throw new AssertionError("bad token should fail");}catch(IOException expected){}io.abort(id);
  String chunk="中文段落🙂".repeat(5000);id=io.beginWrite();long bytes=0;for(int i=0;i<600;i++){io.append(id,chunk);bytes+=chunk.getBytes(java.nio.charset.StandardCharsets.UTF_8).length;}io.finish(id);check(target.length()==bytes&&bytes>12*1024*1024,"large data committed");check(Files.readString(previous.toPath()).equals("original"),"previous file retained");
  byte[] expected=digest(target);String reader=io.beginRead();MessageDigest d=MessageDigest.getInstance("SHA-256");long read=0;for(;;){byte[] b=io.read(reader);check(b.length<=65536,"bounded read chunk");if(b.length==0)break;read+=b.length;d.update(b);}io.endRead(reader);check(read==bytes&&Arrays.equals(expected,d.digest()),"streamed read exact bytes");
  System.out.println("PASS native store IO under 64MB heap: "+bytes+" bytes, bounded read/write, exact Unicode, abort, validation failure, task identity and previous file retention");
  try(java.util.stream.Stream<Path> files=Files.walk(dir)){for(Path p:files.sorted(java.util.Comparator.reverseOrder()).toList())Files.delete(p);}
 }
}
