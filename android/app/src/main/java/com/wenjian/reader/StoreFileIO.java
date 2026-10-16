package com.wenjian.reader;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/** Bounded bridge sessions. The caller supplies platform validation and atomic commit. */
final class StoreFileIO {
 static final long BOOT_AT=System.currentTimeMillis();
 static final int CHUNK=64*1024;static final long MAX=128L*1024*1024;
 interface Source { FileInputStream open()throws Exception; }
 interface Commit { void save(File staged)throws Exception; }
 final File scratch;final Source source;final Commit commit;
 FileInputStream input;FileOutputStream output;File staged;String readId,writeId;long readSize,written;
 StoreFileIO(File scratch,Source source,Commit commit)throws IOException{this.scratch=scratch;this.source=source;this.commit=commit;if(!scratch.exists()&&!scratch.mkdirs())throw new IOException("无法创建资料暂存目录");File[] old=scratch.listFiles();if(old!=null)for(File file:old)if(file.getName().startsWith("reader-")&&file.getName().endsWith(".part")&&file.lastModified()<BOOT_AT)file.delete();}
 synchronized String beginRead()throws Exception{if(input!=null)throw new IOException("上一项资料读取尚未结束");try{input=source.open();}catch(FileNotFoundException e){return null;}readSize=input.getChannel().size();if(readSize>MAX){input.close();input=null;throw new IOException("本机资料超过读取上限，原资料已保留");}readId=UUID.randomUUID().toString();return readId;}
 synchronized byte[] read(String id)throws Exception{if(input==null||!readId.equals(id))throw new IOException("读取任务已变化");byte[] data=new byte[CHUNK];int n=input.read(data);return n<0?new byte[0]:java.util.Arrays.copyOf(data,n);}
 synchronized void endRead(String id)throws IOException{if(input!=null&&readId.equals(id)){input.close();input=null;readId=null;}}
 synchronized String beginWrite()throws Exception{if(output!=null)throw new IOException("上一项资料保存尚未结束");writeId=UUID.randomUUID().toString();staged=File.createTempFile("reader-", ".part",scratch);output=new FileOutputStream(staged);written=0;return writeId;}
 synchronized void append(String id,String text)throws Exception{checkWrite(id);if(text==null||text.length()>CHUNK)throw new IOException("资料分块过大");byte[] data=text.getBytes(StandardCharsets.UTF_8);if(written+data.length>MAX)throw new IOException("本机资料超过128MB，原资料已保留");output.write(data);written+=data.length;}
 synchronized void finish(String id)throws Exception{checkWrite(id);try{output.getFD().sync();output.close();output=null;commit.save(staged);}finally{clearWrite();}}
 synchronized void abort(String id)throws IOException{if(writeId!=null&&writeId.equals(id))clearWrite();}
 private void checkWrite(String id)throws IOException{if(output==null||!writeId.equals(id))throw new IOException("保存任务已变化");}
 private void clearWrite()throws IOException{try{if(output!=null)output.close();}finally{output=null;writeId=null;if(staged!=null)staged.delete();staged=null;}}
}
