const {test}=require('node:test');
const assert=require('node:assert/strict');
const codec=require('../bridge/codec.js');
const fs=require('node:fs');
const vm=require('node:vm');
test('MessagePort values survive websocket JSON transport',()=>{
 const payload={missing:undefined,bytes:new Uint16Array([0,256,65535]),dataView:new DataView(new Uint8Array([1,2]).buffer),
  binary:new Uint8Array([0,255]).buffer,big:1234567890123456789n,nan:NaN,inf:Infinity,date:new Date('2026-01-01'),
  map:new Map([['key',new Set([1,2])]]),array:[undefined,null,{'__proto__':'ordinary input'}]};
 assert.deepEqual(codec.unpack(codec.pack({kind:'port',value:payload})).value,payload);
});
test('object keys cannot set decoded object prototypes',()=>{
 const input=JSON.parse('{"__proto__":{"polluted":true}}');
 const result=codec.decode(codec.encode(input));
 assert.equal(Object.getPrototypeOf(result),Object.prototype);
 assert.equal({}.polluted,undefined);
 assert.deepEqual(Object.getOwnPropertyDescriptor(result,'__proto__').value,{polluted:true});
});
test('reject unsupported values explicitly',()=>{
 assert.throws(()=>codec.encode(new WeakMap()),/Unsupported bridge value/);
 assert.throws(()=>codec.decode(['typed','Function',[]]),/Invalid typed array/);
});
test('large stream chunks stay compact and preserve every byte and view boundary',()=>{
 const buffer=new Uint8Array(2*1024*1024+8);
 for(let i=0;i<buffer.length;i++)buffer[i]=i%256;
 const bytes=buffer.subarray(4,buffer.length-4);
 const value=['stream',['pipeline',6,['write'],[['bytes',bytes]]]];
 const encoded=codec.pack({kind:'port',id:1,value});
 assert(encoded.length<bytes.length*1.34+200,'binary must not expand to decimal JSON arrays');
 assert.deepEqual(codec.unpack(encoded).value,value);
 for(const input of [new DataView(buffer.buffer,3,7),new Uint16Array(buffer.buffer,4,5),new Float64Array(buffer.buffer,8,3)]){
  const output=codec.decode(codec.encode(input));
  assert.equal(output.constructor,input.constructor);
  assert.equal(output.byteLength,input.byteLength);
  assert.deepEqual(new Uint8Array(output.buffer),new Uint8Array(input.buffer,input.byteOffset,input.byteLength));
 }
});
test('browser fallback interoperates with Node without Buffer or native base64 APIs',()=>{
 const context=vm.createContext({btoa:s=>Buffer.from(s,'latin1').toString('base64'),atob:s=>Buffer.from(s,'base64').toString('latin1')});
 vm.runInContext('Uint8Array.prototype.toBase64=undefined;Uint8Array.fromBase64=undefined;',context);
 vm.runInContext(fs.readFileSync('bridge/codec.js','utf8'),context);
 context.incoming=codec.pack({kind:'port',value:new Uint8Array([0,128,255])});
 assert.equal(vm.runInContext('chatgptWebCodec.unpack(incoming).value.join(",")',context),'0,128,255');
 const encoded=vm.runInContext(`(()=>{
  const bytes=new Uint8Array(100003);for(let i=0;i<bytes.length;i++)bytes[i]=i%256;
  return chatgptWebCodec.pack({value:bytes.subarray(3,100000)});
 })()`,context);
 const output=codec.unpack(encoded).value;
 assert.equal(output.length,99997);
 for(let i=0;i<output.length;i++)assert.equal(output[i],(i+3)%256);
 assert.equal(vm.runInContext('chatgptWebCodec.decode(chatgptWebCodec.encode(new ArrayBuffer(0))).byteLength',context),0);
});
test('legacy binary frames remain readable and typed constructors are allowlisted',()=>{
 assert.deepEqual(new Uint8Array(codec.decode(['buffer',[0,255]])),new Uint8Array([0,255]));
 assert.deepEqual(codec.decode(['typed','Uint16Array',[0,1]]),new Uint16Array([256]));
 for(const tag of ['typed','typed64'])for(const type of ['Function','constructor','__proto__']){
  assert.throws(()=>codec.decode([tag,type,tag==='typed'?[]:'']),/Invalid typed array/);
 }
});
