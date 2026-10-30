const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const legacy=process.env.TEACHEM_LEGACY_API_URL,go=process.env.TEACHEM_GO_API_URL;
for(const value of [legacy,go]){const url=new URL(value);assert.equal(url.hostname,'localhost');assert.ok(['4101','4102'].includes(url.port),'Only isolated compatibility ports allowed');}
const origin='http://localhost:8080',password='synthetic-parity-password',email=`parity-${randomUUID()}@example.test`;
function client(base){return {base,cookies:new Map(),csrf:'',async call(path,method='GET',body,expected=200){const headers={Origin:origin,Cookie:[...this.cookies].map(([k,v])=>`${k}=${v}`).join('; ')};if(this.csrf)headers['X-CSRF-Token']=this.csrf;if(body!==undefined)headers['Content-Type']='application/json';const response=await fetch(this.base+'/api/v1'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});for(const cookie of response.headers.getSetCookie()){const [pair]=cookie.split(';'),i=pair.indexOf('=');this.cookies.set(pair.slice(0,i),pair.slice(i+1));}const data=await response.json();assert.equal(response.status,expected,`${method} ${path}: ${response.status} ${data.message||''}`);if(path==='/auth/csrf')this.csrf=data.token;return data;}}}
function normalized(x){return JSON.parse(JSON.stringify(x,(_k,v)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(v)?new Date(v).toISOString():v));}
(async()=>{
 const old=client(legacy);await old.call('/auth/csrf');const created=await old.call('/auth/register','POST',{email,password,name:'Parity tutor',role:'tutor'},201);
 const fresh=client(go);fresh.cookies=new Map(old.cookies);fresh.csrf=old.csrf;
 assert.deepEqual(normalized(await fresh.call('/auth/me')),normalized(await old.call('/auth/me')));
 await fresh.call('/auth/refresh','POST',{},201);old.cookies=new Map(fresh.cookies);assert.equal((await old.call('/auth/me')).id,created.id);
 const body={title:'Parity course',description:'Existing course behavior shared across both server implementations.',subject:'Шахматы',durationDays:45,tags:['#Шахматы','GO_2026'],monthlyPriceMinor:500000};
 const course=await old.call('/courses','POST',body,201);assert.deepEqual(normalized(await fresh.call(`/courses/${course.id}/edit`)),normalized(await old.call(`/courses/${course.id}/edit`)));
 await fresh.call(`/courses/${course.id}`,'PATCH',{durationDays:7,tags:['#Новый','Шахматы']});await old.call(`/courses/${course.id}/publish`,'POST',{},201);
 assert.deepEqual(normalized(await fresh.call(`/courses/${course.id}`)),normalized(await old.call(`/courses/${course.id}`)));
 assert.deepEqual(normalized(await fresh.call('/courses?tag='+encodeURIComponent('#шахматы'))),normalized(await old.call('/courses?tag='+encodeURIComponent('#шахматы'))));
 for(const a of [old,fresh]){await a.call(`/courses/${course.id}`,'PATCH',{tags:['a','b','c','d']},400);await a.call('/users/me','PATCH',{name:'Attempt',role:'SUPERADMIN'},400);await a.call('/admin/users','GET',undefined,403);}
 const profile=await fresh.call('/users/me','PATCH',{name:'Parity renamed',surname:'Preserved'});assert.equal((await old.call('/users/me')).surname,profile.surname);
 await fresh.call('/auth/change-password','POST',{currentPassword:password,newPassword:'synthetic-replacement-password',confirmPassword:'synthetic-replacement-password'},201);await old.call('/auth/me','GET',undefined,401);await old.call('/auth/login','POST',{email,password:'synthetic-replacement-password'},201);fresh.cookies=new Map(old.cookies);assert.equal((await fresh.call('/auth/me')).id,created.id);
 console.log('PASS: TypeScript → Go session, Go refresh → TypeScript, API profile/course/catalog parity, validation and Go password → TypeScript login.');
})().catch(e=>{console.error(e.message);process.exitCode=1});
