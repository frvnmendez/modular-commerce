const U='http://127.0.0.1:3010/';
async function gql(api,query,variables={},h={}){const r=await fetch(U+api,{method:'POST',headers:{'content-type':'application/json',...h},body:JSON.stringify({query,variables})});return {b:await r.json(),t:r.headers.get('vendure-auth-token')};}
const su=(await gql('admin-api',`mutation{login(username:"superadmin",password:"superadmin"){__typename}}`)).t;
const ch=(await gql('admin-api',`{channels{items{code token}}}`,{}, {authorization:'Bearer '+su})).b.data.channels.items.filter(c=>c.code.startsWith('tienda-')).slice(-2);
const [A,B]=ch; const email=`mismo-${Date.now()}@poc.test`;
for (const c of [A,B]) {
  const r=await gql('shop-api',`mutation($i:RegisterCustomerInput!){registerCustomerAccount(input:$i){__typename ... on ErrorResult{message errorCode}}}`,{i:{emailAddress:email,password:'clave-segura-123',firstName:'X',lastName:'Y'}},{'vendure-token':c.token});
  console.log('Registro en', c.code, JSON.stringify(r.b));
}
// Login del mismo cliente en la otra tienda
for (const c of [A,B]) {
  const r=await gql('shop-api',`mutation{login(username:"${email}",password:"clave-segura-123"){__typename ... on ErrorResult{message errorCode}}}`,{}, {'vendure-token':c.token});
  console.log('Login shop en', c.code, JSON.stringify(r.b));
}
