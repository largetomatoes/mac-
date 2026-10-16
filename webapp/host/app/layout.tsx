import type {ReactNode} from 'react';
export const metadata={title:'问间 · Web App',description:'属于自己的阅读与思考空间'};
export default function Layout({children}:{children:ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>;}
