import type {} from '@deepseek-ai/cordis';

declare module '@deepseek-ai/cordis' {
  interface Context {
    teamDeskLifecycle:{
      withGroup<T>(id:string,run:(ids:string[])=>Promise<T>):Promise<T>;
    };
  }
}
