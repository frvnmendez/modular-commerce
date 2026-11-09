// SPIKE ADR-0001 — opción "Vendure + plugin de aislamiento por tienda".
// Objetivo: que un cliente de la tienda A no pueda acabar compartido con la tienda B (fuga de la PoC B).
//
// Vendure 3.8 ata la identidad al email de forma global (User.identifier único y Customer buscado por email
// sin filtrar por canal en create, createOrUpdate, registro y checkout de invitado). Un plugin no puede cambiar
// ese modelo sin reescribir esos servicios, así que este plugin hace lo único que se puede hacer desde fuera:
//   1. Estrategia de asignación por canal que nunca añade un cliente a una segunda tienda al iniciar sesión.
//   2. Barrera en la BD: un trigger sobre la tabla puente customer_channels_channel que rechaza vincular un
//      cliente a una segunda tienda (cualquier canal que no sea el por defecto), venga del camino que venga.
//   3. IDs UUID en lugar de secuenciales (PoC B, hallazgo 4).
// Escrito en JS sin decoradores (Node ejecuta el spike sin compilar): se aplica VendurePlugin() a mano.
import 'reflect-metadata';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { PluginCommonModule, TransactionalConnection, UuidIdStrategy, VendurePlugin } from '@vendure/core';

export const GUARD_SQL = `
CREATE OR REPLACE FUNCTION spike_one_store_per_customer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT code FROM channel WHERE id = NEW."channelId") = '${DEFAULT_CHANNEL_CODE}' THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM customer_channels_channel cc JOIN channel c ON c.id = cc."channelId"
             WHERE cc."customerId" = NEW."customerId" AND c.code <> '${DEFAULT_CHANNEL_CODE}'
               AND cc."channelId" <> NEW."channelId") THEN
    RAISE EXCEPTION 'CUSTOMER_BELONGS_TO_ANOTHER_STORE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS spike_one_store_per_customer ON customer_channels_channel;
CREATE TRIGGER spike_one_store_per_customer BEFORE INSERT ON customer_channels_channel
  FOR EACH ROW EXECUTE FUNCTION spike_one_store_per_customer();`;

/** Nunca asigna automáticamente un cliente a otra tienda al iniciar sesión en ella. */
export class NeverJoinAnotherStoreStrategy {
  canAssignCustomerToChannel() { return false; }
}

class GuardInstaller {
  constructor(connection) { this.connection = connection; }
  async onApplicationBootstrap() {
    await this.connection.rawConnection.query(GUARD_SQL);
  }
}
Reflect.defineMetadata('design:paramtypes', [TransactionalConnection], GuardInstaller);

class StoreIsolationPluginClass {
  constructor(installer) { this.installer = installer; }
  async onApplicationBootstrap() { await this.installer.onApplicationBootstrap(); }
}
Reflect.defineMetadata('design:paramtypes', [GuardInstaller], StoreIsolationPluginClass);

VendurePlugin({
  imports: [PluginCommonModule],
  providers: [GuardInstaller],
  configuration: (config) => {
    config.authOptions.customerChannelAssignmentStrategy = new NeverJoinAnotherStoreStrategy();
    config.entityOptions.entityIdStrategy = new UuidIdStrategy();
    return config;
  },
  compatibility: '^3.8.0',
})(StoreIsolationPluginClass);
export const StoreIsolationPlugin = StoreIsolationPluginClass;
