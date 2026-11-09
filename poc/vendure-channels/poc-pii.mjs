const U='http://127.0.0.1:3010/admin-api';
async function gql(query,variables={},h={}){const r=await fetch(U,{method:'POST',headers:{'content-type':'application/json',...h},body:JSON.stringify({query,variables})});return {b:await r.json(),t:r.headers.get('vendure-auth-token')};}
const su=(await gql(`mutation{login(username:"superadmin",password:"superadmin"){__typename}}`)).t;
const chs=(await gql(`{channels{items{code token}}}`,{}, {authorization:'Bearer '+su})).b.data.channels.items.filter(c=>c.code.startsWith('tienda-')).slice(-2);
const sfx=chs[0].code.split('-').pop();
const tok={};for(const t of ['a','b']) tok[t]=(await gql(`mutation{login(username:"admin-${t}-${sfx}@poc.test",password:"clave-segura-123"){__typename}}`)).t;
const H=(t,c)=>({authorization:'Bearer '+tok[t],'vendure-token':c.token});
// El admin de A busca al cliente compartido y le añade una dirección (dato personal de la tienda A)
let r=await gql(`{customers(options:{filter:{emailAddress:{contains:"mismo-"}}}){items{id emailAddress}}}`,{},H('a',chs[0]));
const cid=r.b.data.customers.items.at(-1).id; console.log('Admin A ve cliente', cid);
r=await gql(`mutation($id:ID!){createCustomerAddress(customerId:$id,input:{fullName:"Dato privado de A",streetLine1:"Calle Secreta 1",countryCode:"${(await gql(`{countries{items{code}}}`,{}, {authorization:'Bearer '+su})).b.data.countries.items.at(-1).code}"}){id}}`,{id:cid},H('a',chs[0]));
console.log('Dirección creada por A', JSON.stringify(r.b));
// El admin de B lee el mismo cliente
r=await gql(`query($id:ID!){customer(id:$id){id emailAddress addresses{fullName streetLine1}}}`,{id:cid},H('b',chs[1]));
console.log('Admin B lee cliente compartido', JSON.stringify(r.b));
