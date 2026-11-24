import {open,mkdir,type FileHandle} from 'node:fs/promises';
import {dirname} from 'node:path';
import {spawn} from 'node:child_process';
import {CoordinationError} from './errors.ts';
/** Linux flock follows the shared open-file description, retained by this parent FD.
 * Never unlink the lock file: a new inode would permit a second writer. */
export async function acquireWriter(path:string):Promise<FileHandle>{
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  const handle=await open(path,'a+',0o600);
  try{
    await new Promise<void>((resolve,reject)=>{
      const child=spawn('flock',['--exclusive','--nonblock','--conflict-exit-code','73','3'],{stdio:['ignore','ignore','pipe',handle.fd]});
      child.once('error',()=>reject(new CoordinationError('WRITER_LOCK_UNAVAILABLE','需要本机 flock 才能安全启用团队协作')));
      child.once('exit',code=>code===0?resolve():reject(new CoordinationError('WRITER_BUSY','同一团队数据目录已有写入者，未启动第二个派发器')));
    });
    return handle;
  }catch(error){await handle.close();throw error;}
}
