const { bootstrap, DefaultLogger, LogLevel } = require('@vendure/core');
const config = {
  apiOptions: { port: 3010, adminApiPath: 'admin-api', shopApiPath: 'shop-api' },
  authOptions: { tokenMethod: 'bearer', superadminCredentials: { identifier: 'superadmin', password: 'superadmin' } },
  dbConnectionOptions: { type: 'postgres', synchronize: true, host: '127.0.0.1', port: 5432, username: 'postgres', password: 'postgres', database: 'vendure_poc', logging: false },
  paymentOptions: { paymentMethodHandlers: [] },
  logger: new DefaultLogger({ level: LogLevel.Warn }),
  plugins: [],
};
bootstrap(config).then(() => console.log('VENDURE_READY')).catch((e) => { console.error(e); process.exit(1); });
