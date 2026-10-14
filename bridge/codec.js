// MessagePort uses structured clone; JSON alone loses binary data and undefined.
(function(root){
  function base64(bytes){
    if(typeof bytes.toBase64==='function')return bytes.toBase64();
    if(typeof Buffer==='function')return Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength).toString('base64');
    // Bound the temporary string and argument list on browsers without the
    // typed-array base64 API. Never allocate a JS number array for each byte.
    let binary='';
    for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));
    return btoa(binary);
  }
  function unbase64(value){
    if(typeof Uint8Array.fromBase64==='function')return Uint8Array.fromBase64(value);
    if(typeof Buffer==='function')return Uint8Array.from(Buffer.from(value,'base64'));
    const binary=atob(value),bytes=new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
    return bytes;
  }
  function encode(v){
    if(v===undefined)return ['undefined'];
    if(typeof v==='bigint')return ['bigint',String(v)];
    if(typeof v==='number'&&!Number.isFinite(v))return ['number',String(v)];
    if(v===null || typeof v!=='object')return ['value',v];
    if(v instanceof Date)return ['date',v.toISOString()];
    if(v instanceof ArrayBuffer)return ['buffer64',base64(new Uint8Array(v))];
    if(ArrayBuffer.isView(v))return ['typed64',v.constructor.name,base64(new Uint8Array(v.buffer,v.byteOffset,v.byteLength))];
    if(v instanceof Map)return ['map',Array.from(v,([k,x])=>[encode(k),encode(x)])];
    if(v instanceof Set)return ['set',Array.from(v,encode)];
    if(Array.isArray(v))return ['array',Array.from(v,encode)];
    if(Object.getPrototypeOf(v)!==Object.prototype && Object.getPrototypeOf(v)!==null)throw Error(`Unsupported bridge value: ${v.constructor?.name}`);
    return ['object',Object.entries(v).map(([k,x])=>[k,encode(x)])];
  }
  const typed=Object.fromEntries(['Int8Array','Uint8Array','Uint8ClampedArray','Int16Array','Uint16Array','Int32Array','Uint32Array','Float32Array','Float64Array','BigInt64Array','BigUint64Array','DataView'].map(k=>[k,globalThis[k]]));
  function decode(v){
    switch(v[0]){
      case 'undefined':return undefined;
      case 'value':return v[1];
      case 'bigint':return BigInt(v[1]);
      case 'number':return Number(v[1]);
      case 'date':return new Date(v[1]);
      case 'buffer64':return unbase64(v[1]).buffer;
      case 'typed64':if(!Object.hasOwn(typed,v[1]))throw Error('Invalid typed array');return new typed[v[1]](unbase64(v[2]).buffer);
      case 'buffer':return Uint8Array.from(v[1]).buffer;
      case 'typed':if(!Object.hasOwn(typed,v[1]))throw Error('Invalid typed array');return new typed[v[1]](Uint8Array.from(v[2]).buffer);
      case 'array':return v[1].map(decode);
      case 'object':return Object.fromEntries(v[1].map(([k,x])=>[k,decode(x)]));
      case 'map':return new Map(v[1].map(([k,x])=>[decode(k),decode(x)]));
      case 'set':return new Set(v[1].map(decode));
      default:throw Error('Invalid bridge encoding');
    }
  }
  function pack(m){const copy={...m};for(const key of ['value','args'])if(key in copy)copy[key]=encode(copy[key]);return JSON.stringify(copy);}
  function unpack(s){const m=JSON.parse(s);for(const key of ['value','args'])if(key in m)m[key]=decode(m[key]);return m;}
  const codec={encode,decode,pack,unpack};
  if(typeof module==='object')module.exports=codec;else root.chatgptWebCodec=codec;
})(globalThis);
