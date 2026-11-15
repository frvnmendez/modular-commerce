// SPIKE ADR-0001 — ¿cierra un plugin la fuga de clientes entre tiendas de Vendure 3.8.1?
// Uso: PLUGIN=off|on node test/run.mjs   (cada ejecución crea una BD nueva y arranca Vendure en el proceso)
import pg from 'pg';
import { bootstrap, DefaultLogger, LogLevel, TransactionalConnection } from '@vendure/core';
import { StoreIsolationPlugin } from '../src/store-isolation-plugin.mjs';

const MODE = process.env.PLUGIN === 'on' ? 'on' : 'off';
const PORT = 3011;
const DB = `vendure_spike_${MODE}`;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/postgres';

const admin = new pg.Client({ connectionString: ADMIN_URL });
await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
await admin.query(`CREATE DATABASE ${DB}`);
await admin.end();
const u = new URL(ADMIN_URL);

const app = await bootstrap({
  apiOptions: { port: PORT, adminApiPath: 'admin-api', shopApiPath: 'shop-api' },
  authOptions: { tokenMethod: 'bearer', requireVerification: false, superadminCredentials: { identifier: 'superadmin', password: 'superadmin' } },
  dbConnectionOptions: { type: 'postgres', synchronize: true, host: u.hostname, port: Number(u.port), username: u.username, password: u.password, database: DB, logging: false },
  paymentOptions: { paymentMethodHandlers: [] },
  logger: new DefaultLogger({ level: LogLevel.Error }),
  plugins: MODE === 'on' ? [StoreIsolationPlugin] : [],
});

const results = [];
// kind 'fuga' = problema de aislamiento; kind 'venta' = el aislamiento rompe una compra legítima.
const check = (id, name, bad, detail, kind = 'fuga') => {
  results.push({ id, name, bad, kind, detail });
  console.log(`${bad ? (kind === 'fuga' ? 'FUGA         ' : 'VENTA PERDIDA') : 'OK           '} | ${id} ${name} | ${JSON.stringify(detail).slice(0, 600)}`);
};
async function gql(api, query, variables = {}, { token, channel } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (channel) headers['vendure-token'] = channel;
  const res = await fetch(`http://127.0.0.1:${PORT}/${api}`, { method: 'POST', headers, body: JSON.stringify({ query, variables }) });
  return { body: await res.json(), token: res.headers.get('vendure-auth-token') ?? token };
}
const must = (r) => { if (r.body.errors) throw new Error(JSON.stringify(r.body.errors)); return r.body.data; };
const login = async (api, username, password, channel) => {
  const r = await gql(api, `mutation($u:String!,$p:String!){login(username:$u,password:$p){__typename ... on ErrorResult{errorCode message}}}`, { u: username, p: password }, { channel });
  return { token: r.token, result: r.body.data?.login ?? r.body.errors };
};

try {
  // --- Preparación: dos tiendas (canales), un admin por tienda, un producto con stock en cada una ---------------------
  const su = (await login('admin-api', 'superadmin', 'superadmin')).token;
  const S = { token: su };
  const country = must(await gql('admin-api', `mutation{createCountry(input:{code:"ES",enabled:true,translations:[{languageCode:en,name:"España"}]}){id}}`, {}, S)).createCountry;
  const zone = must(await gql('admin-api', `mutation($m:[ID!]){createZone(input:{name:"ES",memberIds:$m}){id}}`, { m: [country.id] }, S)).createZone;
  const taxCat = must(await gql('admin-api', `mutation{createTaxCategory(input:{name:"General",isDefault:true}){id}}`, {}, S)).createTaxCategory;
  must(await gql('admin-api', `mutation($z:ID!,$c:ID!){createTaxRate(input:{name:"IVA 21",enabled:true,value:21,categoryId:$c,zoneId:$z}){id}}`, { z: zone.id, c: taxCat.id }, S));
  const T = {};
  for (const t of ['a', 'b']) {
    const code = `tienda-${t}`;
    const ch = must(await gql('admin-api', `mutation($i:CreateChannelInput!){createChannel(input:$i){... on Channel{id token code}}}`,
      { i: { code, token: `tok-${code}`, defaultLanguageCode: 'en', pricesIncludeTax: true, defaultCurrencyCode: 'EUR', defaultShippingZoneId: zone.id, defaultTaxZoneId: zone.id } }, S)).createChannel;
    const role = must(await gql('admin-api', `mutation($i:CreateRoleInput!){createRole(input:$i){id}}`,
      { i: { code: `admin-${code}`, description: code, channelIds: [ch.id], permissions: ['CreateCatalog', 'ReadCatalog', 'UpdateCatalog', 'ReadCustomer', 'CreateCustomer', 'UpdateCustomer', 'ReadOrder', 'UpdateOrder', 'ReadSettings', 'ReadChannel'] } }, S)).createRole;
    must(await gql('admin-api', `mutation($i:CreateAdministratorInput!){createAdministrator(input:$i){id}}`,
      { i: { firstName: 'Admin', lastName: t, emailAddress: `admin-${t}@spike.test`, password: 'clave-segura-123', roleIds: [role.id] } }, S));
    const token = (await login('admin-api', `admin-${t}@spike.test`, 'clave-segura-123')).token;
    const H = { token, channel: ch.token };
    const p = must(await gql('admin-api', `mutation($i:CreateProductInput!){createProduct(input:$i){id}}`,
      { i: { translations: [{ languageCode: 'en', name: `Camiseta ${t}`, slug: `camiseta-${t}`, description: '' }] } }, H)).createProduct;
    const v = must(await gql('admin-api', `mutation($i:[CreateProductVariantInput!]!){createProductVariants(input:$i){id}}`,
      { i: [{ productId: p.id, sku: `CAM-${t}`, price: 1999, trackInventory: 'FALSE', translations: [{ languageCode: 'en', name: 'M' }] }] }, H)).createProductVariants[0];
    T[t] = { ch, H, variantId: v.id };
  }
  const { a: A, b: B } = T;
  const findCustomer = async (who, email) => (await gql('admin-api', `query($e:String!){customers(options:{filter:{emailAddress:{eq:$e}}}){items{id firstName lastName phoneNumber emailAddress addresses{streetLine1}}}}`, { e: email }, who.H)).body.data?.customers.items[0];

  // --- F1: el mismo email se registra en A y en B (repro de la PoC B) ---------------------------------------------
  const maria = 'maria@cliente.test';
  const reg = {};
  for (const [t, who] of [['a', A], ['b', B]]) {
    reg[t] = (await gql('shop-api', `mutation($i:RegisterCustomerInput!){registerCustomerAccount(input:$i){__typename ... on ErrorResult{errorCode message}}}`,
      { i: { emailAddress: maria, password: `clave-de-${t}-123`, firstName: 'María', lastName: t.toUpperCase() } }, { channel: who.ch.token })).body;
  }
  const custA = await findCustomer(A, maria);
  if (!custA) throw new Error("sin cliente en A: " + JSON.stringify({ reg, lista: (await gql("admin-api", "{customers{items{id emailAddress}}}", {}, A.H)).body }));
  must(await gql('admin-api', `mutation($id:ID!){createCustomerAddress(customerId:$id,input:{fullName:"María",streetLine1:"Calle privada de A 1",countryCode:"ES"}){id}}`, { id: custA.id }, A.H));
  const seenByB = await findCustomer(B, maria);
  check('F1', 'mismo email registrado en A y B: B ve la dirección que guardó A', !!seenByB?.addresses?.some((x) => x.streetLine1.includes('privada de A')),
    { registroEnB: reg.b, mismoId: seenByB?.id === custA.id, direccionesQueVeB: seenByB?.addresses ?? null });

  // --- F2: la contraseña que María puso al registrarse en B no le da cuenta propia en B --------------------------
  const loginB = await login('shop-api', maria, 'clave-de-b-123', B.ch.token);
  const loginBwithA = await login('shop-api', maria, 'clave-de-a-123', B.ch.token);
  check('F2', 'credenciales de A sirven para entrar en la tienda B', loginBwithA.result?.__typename === 'CurrentUser',
    { loginConClaveDeB: loginB.result?.__typename ?? loginB.result, loginConClaveDeA: loginBwithA.result?.__typename ?? loginBwithA.result });

  // --- F3: con la sesión de A, María compra en B: ¿ve B los datos del cliente de A en el pedido? ------------------
  let orderCode = null;
  if (loginBwithA.result?.__typename === 'CurrentUser') {
    const sess = { token: loginBwithA.token, channel: B.ch.token };
    const add = await gql('shop-api', `mutation($v:ID!){addItemToOrder(productVariantId:$v,quantity:1){__typename ... on Order{code} ... on ErrorResult{errorCode message}}}`, { v: B.variantId }, sess);
    orderCode = add.body.data?.addItemToOrder?.code ?? null;
    const me = await gql('shop-api', `{activeCustomer{id emailAddress addresses{streetLine1}} activeOrder{code customer{id emailAddress addresses{streetLine1}}}}`, {}, sess);
    // Lo que ve el ADMIN de B en ese pedido de su tienda:
    const ordB = orderCode && (await gql('admin-api', `query($c:String!){orders(options:{filter:{code:{eq:$c}}}){items{code customer{id emailAddress addresses{streetLine1}}}}}`, { c: orderCode }, B.H)).body;
    const seen = JSON.stringify([me.body.data, ordB]);
    check('F3', 'sesión de A usada en B: la tienda B (tienda o admin) ve direcciones guardadas en A', seen.includes('privada de A'),
      { pedidoEnB: add.body.data?.addItemToOrder, enLaTiendaB: me.body.data ?? me.body.errors, adminDeB: ordB?.data?.orders?.items ?? ordB?.errors });
    // F9: ¿puede María terminar la compra en B con su cuenta? (requiere cliente en el pedido)
    const setC = await gql('shop-api', `mutation{setCustomerForOrder(input:{emailAddress:"${maria}",firstName:"María",lastName:"B"}){__typename ... on ErrorResult{errorCode}}}`, {}, sess);
    const tr = await gql('shop-api', `mutation{transitionOrderToState(state:"ArrangingPayment"){__typename ... on Order{state} ... on OrderStateTransitionError{transitionError}}}`, {}, sess);
    const r9 = tr.body.data?.transitionOrderToState;
    check('F9', 'María (cliente de A) no puede completar una compra en B con su cuenta', String(r9?.transitionError ?? '').includes('Customer'),
      { setCustomerForOrder: setC.body.data?.setCustomerForOrder ?? setC.body.errors?.[0]?.message, pasarAPago: r9 ?? tr.body.errors?.[0]?.message }, 'venta');
  } else check('F3', 'sesión de A usada en B', false, 'no aplica: el login en B con la clave de A no funcionó');
  // F1b: tras ese login en B, ¿el admin de B ve al cliente de A y su dirección? (camino de la fuga de la PoC B en 3.8.1)
  const seenByBAfter = await findCustomer(B, maria);
  check('F1b', 'tras iniciar sesión en B, el admin de B ve el cliente de A y su dirección', !!seenByBAfter?.addresses?.some((x) => x.streetLine1.includes('privada de A')),
    { mismoIdQueEnA: seenByBAfter ? seenByBAfter.id === custA.id : null, direccionesQueVeB: seenByBAfter?.addresses ?? null });

  // --- F4: invitado en B con el email de un cliente INVITADO de A: ¿sobrescribe B los datos de A? -----------------
  const lucia = 'lucia@invitada.test';
  const guest = async (who, firstName, phone) => {
    const s = { channel: who.ch.token };
    const add = await gql('shop-api', `mutation($v:ID!){addItemToOrder(productVariantId:$v,quantity:1){__typename ... on Order{code}}}`, { v: who.variantId }, s);
    s.token = add.token;
    const r = await gql('shop-api', `mutation($i:CreateCustomerInput!){setCustomerForOrder(input:$i){__typename ... on ErrorResult{errorCode message}}}`,
      { i: { emailAddress: lucia, firstName, lastName: 'Invitada', phoneNumber: phone } }, s);
    return r.body.data?.setCustomerForOrder ?? r.body.errors;
  };
  const gA = await guest(A, 'Lucía', '+34 600 000 001');
  const gB = await guest(B, 'Suplantada', '+34 699 999 999');
  const luciaInA = await findCustomer(A, lucia);
  check('F4', 'checkout de invitado en B reescribe nombre y teléfono del cliente de A', luciaInA?.firstName !== 'Lucía' || luciaInA?.phoneNumber !== '+34 600 000 001',
    { checkoutA: gA.__typename ?? gA, checkoutB: gB?.__typename ?? gB, clienteDeAhora: luciaInA && { firstName: luciaInA.firstName, phone: luciaInA.phoneNumber } });
  check('F4b', 'checkout de invitado en B con email ya usado en A: se pierde la venta en B', !(gB?.__typename === 'Order'), { checkoutB: gB }, 'venta');

  // --- F5: B intenta dar de alta (admin) al cliente registrado de A: ¿revela que existe en otra tienda? ----------
  const created = (await gql('admin-api', `mutation{createCustomer(input:{firstName:"Otro",lastName:"Nombre",emailAddress:"${maria}"}){__typename ... on ErrorResult{errorCode message}}}`, {}, B.H)).body;
  const fresh = (await gql('admin-api', `mutation{createCustomer(input:{firstName:"Nadie",lastName:"X",emailAddress:"nuevo-${Date.now()}@cliente.test"}){__typename ... on ErrorResult{errorCode message}}}`, {}, B.H)).body;
  const r5 = (x) => x.data?.createCustomer?.__typename ?? x.data?.createCustomer?.errorCode ?? x.errors?.[0]?.message;
  check('F5', 'alta de cliente en B responde distinto si el email ya es cliente de otra tienda (enumeración)', r5(created) !== r5(fresh), { emailDeA: r5(created), emailNuevo: r5(fresh) });

  // --- F6: datos globales visibles para el admin de una tienda ---------------------------------------------------
  const g = await gql('admin-api', `{countries{totalItems} zones{totalItems} taxCategories{totalItems} taxRates{totalItems}}`, {}, A.H);
  check('F6', 'países, zonas e impuestos globales visibles desde la tienda A', !g.body.errors, g.body.data ?? g.body.errors?.map((e) => e.message));

  // --- F7: código de plugin en el proceso: lee todos los clientes de todas las tiendas ---------------------------
  const rows = await app.get(TransactionalConnection).rawConnection.query('SELECT count(*)::int AS n, count(DISTINCT "emailAddress")::int AS emails FROM customer');
  check('F7', 'un plugin (mismo proceso) lee los clientes de todas las tiendas sin pasar por permisos', true, rows[0]);

  // --- F8: IDs secuenciales -------------------------------------------------------------------------------------
  check('F8', 'IDs de cliente secuenciales y compartidos entre tiendas', /^\d+$/.test(String(custA.id)), { idClienteA: custA.id });

  // --- Huella ----------------------------------------------------------------------------------------------------
  console.log(JSON.stringify({ modo: MODE, rssMB: Math.round(process.memoryUsage().rss / 1048576), fugas: results.filter((r) => r.bad && r.kind === 'fuga').map((r) => r.id), ventasPerdidas: results.filter((r) => r.bad && r.kind === 'venta').map((r) => r.id) }));
} finally {
  await app.close();
}
