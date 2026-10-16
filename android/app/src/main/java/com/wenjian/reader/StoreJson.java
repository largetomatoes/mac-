package com.wenjian.reader;
import android.util.JsonReader;
import android.util.JsonWriter;
import android.util.JsonToken;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Scans the store without constructing its OCR or journal object graph. */
final class StoreJson {
 static final class Book {String name="",format="";}
 static final class Info {long version=-1;int organization=1;boolean data,notes;List<Book> books=new ArrayList<>();}
 static Info scan(File source,File drafts)throws Exception{
  Info info=new Info();boolean wroteDrafts=false;
  try(JsonReader r=new JsonReader(new InputStreamReader(new FileInputStream(source),StandardCharsets.UTF_8));JsonWriter w=drafts==null?null:new JsonWriter(new OutputStreamWriter(new FileOutputStream(drafts),StandardCharsets.UTF_8))){
   if(w!=null)w.beginObject();r.beginObject();while(r.hasNext()){
    String key=r.nextName();if(key.equals("version"))info.version=r.nextLong();
    else if(key.equals("data")){info.data=true;r.beginObject();while(r.hasNext()){
     String name=r.nextName();if(name.equals("notes")){r.beginArray();info.notes=r.hasNext();while(r.hasNext())r.skipValue();r.endArray();}
     else if(name.equals("organizationVersion"))info.organization=r.nextInt();
     else if(name.equals("libraryBooks")){r.beginArray();while(r.hasNext()){Book book=new Book();r.beginObject();while(r.hasNext()){String field=r.nextName();if(field.equals("storedFile"))book.name=r.nextString();else if(field.equals("format"))book.format=r.nextString();else r.skipValue();}r.endObject();info.books.add(book);}r.endArray();}
     else r.skipValue();}r.endObject();}
    else if(key.equals("drafts")&&w!=null){if(r.peek()!=JsonToken.BEGIN_OBJECT)throw new IOException("草稿格式无效");w.name("drafts");copy(r,w,0);wroteDrafts=true;}
    else r.skipValue();
   }r.endObject();if(r.peek()!=JsonToken.END_DOCUMENT||info.version<0||!info.data||!info.notes)throw new IOException("资料格式不完整，原资料已保留");
   if(w!=null){if(!wroteDrafts)w.name("drafts").beginObject().endObject();w.endObject();}
  }return info;
 }
 private static void copy(JsonReader r,JsonWriter w,int depth)throws Exception{
  if(depth>256)throw new IOException("草稿层级过深，原资料已保留");
  switch(r.peek()){
   case BEGIN_OBJECT:w.beginObject();r.beginObject();while(r.hasNext()){w.name(r.nextName());copy(r,w,depth+1);}r.endObject();w.endObject();break;
   case BEGIN_ARRAY:w.beginArray();r.beginArray();while(r.hasNext())copy(r,w,depth+1);r.endArray();w.endArray();break;
   case STRING:w.value(r.nextString());break;
   case NUMBER:w.value(new java.math.BigDecimal(r.nextString()));break;
   case BOOLEAN:w.value(r.nextBoolean());break;
   case NULL:r.nextNull();w.nullValue();break;
   default:throw new IOException("草稿内容不完整");
  }
 }
}
