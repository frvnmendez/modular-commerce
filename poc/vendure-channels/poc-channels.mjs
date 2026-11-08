// PoC: ¿son los canales de Vendure una frontera de seguridad suficiente entre dos tiendas?
const URL_ = 'http://127.0.0.1:3010/admin-api';
const results = [];
async function gql(query, variables = {}, { token, channel } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (channel) headers['vendure-token'] = channel;
  const res = await fetch(URL_, { method: 'POST', headers, body: JSON.stringify({ query, variables }) });
  const body = await res.json();
  return { body, authToken: res.headers.get('vendure-auth-token') };
}
async function login(u, p) {
  const r = await gql(`mutation($u:String!,$p:String!){login(username:$u,password:$p){__typename ... on CurrentUser{id} ... on ErrorResult{message}}}`, { u, p });
  if (!r.authToken) throw new Error('login failed ' + JSON.stringify(r.body));
  return r.authToken;
}
function check(name, ok, detail) { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} | ${name} | ${JSON.stringify(detail).slice(0, 220)}`); }
const must = (r) => { if (r.body.errors) throw new Error(JSON.stringify(r.body.errors)); return r.body.data; };

const su = await login('superadmin', 'superadmin');
const sfx = Date.now().toString(36);
const country = must(await gql(`mutation{createCountry(input:{code:"X${sfx.slice(-1)}",enabled:true,translations:[{languageCode:en,name:"Testland ${sfx}"}]}){id}}`, {}, { token: su })).createCountry;
const zone = must(await gql(`mutation($m:[ID!]){createZone(input:{name:"Zona ${sfx}",memberIds:$m}){id}}`, { m: [country.id] }, { token: su })).createZone;
const tenants = {};
for (const t of ['A', 'B']) {
  const code = `tienda-${t.toLowerCase()}-${sfx}`;
  const ch = must(await gql(`mutation($i:CreateChannelInput!){createChannel(input:$i){__typename ... on Channel{id token code} ... on ErrorResult{message}}}`,
    { i: { code, token: `tok-${code}`, defaultLanguageCode: 'en', pricesIncludeTax: false, defaultCurrencyCode: 'EUR', defaultShippingZoneId: zone.id, defaultTaxZoneId: zone.id } }, { token: su })).createChannel;
  const role = must(await gql(`mutation($i:CreateRoleInput!){createRole(input:$i){id}}`,
    { i: { code: `admin-${code}`, description: `Admin ${t}`, channelIds: [ch.id], permissions: ['CreateCatalog','ReadCatalog','UpdateCatalog','DeleteCatalog','ReadCustomer','CreateCustomer','UpdateCustomer','DeleteCustomer','ReadOrder','UpdateOrder','ReadSettings','ReadChannel'] } }, { token: su })).createRole;
  const email = `admin-${t.toLowerCase()}-${sfx}@poc.test`;
  must(await gql(`mutation($i:CreateAdministratorInput!){createAdministrator(input:$i){id}}`,
    { i: { firstName: 'Admin', lastName: t, emailAddress: email, password: 'clave-segura-123', roleIds: [role.id] } }, { token: su }));
  const token = await login(email, 'clave-segura-123');
  const product = must(await gql(`mutation($i:CreateProductInput!){createProduct(input:$i){id}}`,
    { i: { translations: [{ languageCode: 'en', name: `Producto ${t}`, slug: `producto-${t.toLowerCase()}-${sfx}`, description: '' }] } }, { token, channel: ch.token })).createProduct;
  const customer = must(await gql(`mutation($i:CreateCustomerInput!){createCustomer(input:$i){__typename ... on Customer{id}}}`,
    { i: { firstName: 'Cliente', lastName: t, emailAddress: `cliente-${t.toLowerCase()}-${sfx}@poc.test` } }, { token, channel: ch.token })).createCustomer;
  tenants[t] = { ch, token, product, customer };
}
const { A, B } = tenants;

// 1. Lectura legítima
let r = must(await gql(`{products{items{id name}}}`, {}, { token: A.token, channel: A.ch.token }));
check('Admin A lista solo productos de A en su canal', r.products.items.length === 1 && r.products.items[0].id === A.product.id, r.products.items);

// 2. IDOR por ID con el canal propio
r = await gql(`query($id:ID!){product(id:$id){id name}}`, { id: B.product.id }, { token: A.token, channel: A.ch.token });
check('Admin A pide producto de B por ID (canal A) → no lo ve', !r.body.data?.product, r.body);

// 3. Manipulación de cabecera: admin A envía el token del canal B
r = await gql(`query($id:ID!){product(id:$id){id name}}`, { id: B.product.id }, { token: A.token, channel: B.ch.token });
check('Admin A cambia cabecera vendure-token al canal B → denegado', !r.body.data?.product, r.body);

// 4. Escritura cruzada
r = await gql(`mutation($id:ID!){updateProduct(input:{id:$id,translations:[{languageCode:en,name:"hackeado"}]}){id name}}`, { id: B.product.id }, { token: A.token, channel: A.ch.token });
check('Admin A intenta renombrar producto de B → denegado', !r.body.data?.updateProduct || r.body.data.updateProduct.name !== 'hackeado', r.body);
r = await gql(`mutation($id:ID!){deleteProduct(id:$id){result message}}`, { id: B.product.id }, { token: A.token, channel: A.ch.token });
check('Admin A intenta borrar producto de B → denegado', r.body.data?.deleteProduct?.result !== 'DELETED', r.body);

// 5. Clientes
r = await gql(`{customers{items{id emailAddress}}}`, {}, { token: A.token, channel: A.ch.token });
check('Admin A lista clientes → solo ve los de A', (r.body.data?.customers?.items ?? []).every((c) => c.id !== B.customer.id), r.body);
r = await gql(`query($id:ID!){customer(id:$id){id emailAddress}}`, { id: B.customer.id }, { token: A.token, channel: A.ch.token });
check('Admin A pide cliente de B por ID → no lo ve', !r.body.data?.customer, r.body);

// 6. Datos globales compartidos entre canales (configuración que NO es por tienda)
r = await gql(`{countries{items{id}} zones{items{id}} taxCategories{items{id}}}`, {}, { token: A.token, channel: A.ch.token });
check('Información: entidades globales (países/zonas/impuestos) visibles para el admin de A', true, { visible: !r.body.errors, errors: r.body.errors?.map((e) => e.message) });

// 7. Superadmin / canal por defecto
r = must(await gql(`{products(options:{take:100}){items{id name channels{code}}}}`, {}, { token: su }));
const both = r.products.items.filter((p) => [A.product.id, B.product.id].includes(p.id));
check('Información: productos creados en A y B también quedan asignados al canal por defecto', true, both);

console.log('\nRESUMEN', JSON.stringify({ pass: results.filter((x) => x.ok).length, fail: results.filter((x) => !x.ok).length }));
