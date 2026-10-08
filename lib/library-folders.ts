import type {LibraryBook, LibraryFolder, Notebook} from './notebook';

export const LIBRARY_FOLDER_NAME_LIMIT = 100;

export function normalizeLibraryFolders(value:unknown):LibraryFolder[] {
 if(!Array.isArray(value))return [];
 const seen=new Set<string>();
 return value.filter((folder):folder is LibraryFolder=>{
  if(!folder||typeof folder!=='object'||typeof folder.id!=='string'||!folder.id.trim()||typeof folder.name!=='string'||!folder.name.trim()||seen.has(folder.id))return false;
  seen.add(folder.id);
  return true;
 }).map(folder=>({...folder,name:folder.name.trim()}));
}

// A missing folder is shown as unclassified without destroying the saved reference.
export function folderForBook(book:Pick<LibraryBook,'folderId'>,folders:LibraryFolder[]=[]):string|null {
 return book.folderId&&folders.some(folder=>folder.id===book.folderId)?book.folderId:null;
}

function checkedName(folders:LibraryFolder[],value:string,exceptId?:string):string {
 const name=value.trim();
 if(!name)throw new Error('请输入文件夹名称。');
 if(name.length>LIBRARY_FOLDER_NAME_LIMIT)throw new Error(`文件夹名称不能超过 ${LIBRARY_FOLDER_NAME_LIMIT} 个字。`);
 if(folders.some(folder=>folder.id!==exceptId&&folder.name.trim().toLocaleLowerCase()===name.toLocaleLowerCase()))throw new Error('已经有同名文件夹了。');
 return name;
}

export function addLibraryFolder(data:Notebook,folder:LibraryFolder):Notebook {
 const folders=data.libraryFolders||[];
 if(!folder.id.trim()||folder.id.length>100)throw new Error('文件夹标识无效。');
 if(folders.some(existing=>existing.id===folder.id))throw new Error('文件夹标识重复。');
 const name=checkedName(folders,folder.name);
 return {...data,libraryFolders:[...folders,{...folder,name}]};
}

export function renameLibraryFolder(data:Notebook,id:string,name:string):Notebook {
 const folders=data.libraryFolders||[];
 if(!folders.some(folder=>folder.id===id))throw new Error('这个文件夹已不存在。');
 const checked=checkedName(folders,name,id);
 return {...data,libraryFolders:folders.map(folder=>folder.id===id?{...folder,name:checked}:folder)};
}

export function removeLibraryFolder(data:Notebook,id:string):Notebook {
 const folders=data.libraryFolders||[];
 if(!folders.some(folder=>folder.id===id))throw new Error('这个文件夹已不存在。');
 return {...data,libraryFolders:folders.filter(folder=>folder.id!==id),libraryBooks:data.libraryBooks.map(book=>{
  if(book.folderId!==id)return book;
  const next={...book};
  delete next.folderId;
  return next;
 })};
}

export function assignBookFolder(data:Notebook,bookId:string,folderId:string|null):Notebook {
 if(!data.libraryBooks.some(book=>book.id===bookId))throw new Error('这本书已不存在。');
 if(folderId!==null&&!(data.libraryFolders||[]).some(folder=>folder.id===folderId))throw new Error('这个文件夹已不存在。');
 return {...data,libraryBooks:data.libraryBooks.map(book=>{
  if(book.id!==bookId)return book;
  const next={...book};
  if(folderId===null)delete next.folderId;
  else next.folderId=folderId;
  return next;
 })};
}
