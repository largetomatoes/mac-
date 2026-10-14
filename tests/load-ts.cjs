const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const cache=new Map();
function load(file){const resolved=path.resolve(file);if(cache.has(resolved))return cache.get(resolved).exports;const module={exports:{}};cache.set(resolved,module);
 const code=ts.transpileModule(fs.readFileSync(resolved,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const localRequire=name=>{if(name.startsWith('.')||name.startsWith('@/')){const base=name.startsWith('@/')?path.resolve(name.slice(2)):path.resolve(path.dirname(resolved),name);if(fs.existsSync(base)&&!base.endsWith('.ts'))return require(base);if(fs.existsSync(base+'.ts'))return load(base+'.ts');if(fs.existsSync(base))return load(base);}return require(name);};
 vm.runInNewContext(code,{module,exports:module.exports,require:localRequire,crypto:require('node:crypto'),structuredClone,URL,TextEncoder,TextDecoder,Response,Request,AbortController,setTimeout,clearTimeout,console});return module.exports;
}
module.exports={load,plain:value=>JSON.parse(JSON.stringify(value))};
