import 'server-only';
import { databaseKind, isDatabaseConfigured } from '../db/client';
import {
  memoryOtpRepository,
  memoryPasswordResetRepository,
  memoryUserRepository,
} from './memoryRepository';
import {
  postgresOtpRepository,
  postgresPasswordResetRepository,
  postgresUserRepository,
} from './postgresRepository';
import type { OtpRepository, PasswordResetRepository, UserRepository } from './types';

/**
 * Two backends, not three.
 *
 * Products, orders and analytics get a retailer-API backend because that data is the
 * retailer's. Accounts are not: who may sign in to SnapUp is SnapUp's question. Routing it
 * through the supermarket's API would mean an outage at one branch locked staff out of the
 * console for all eight, and would ask a grocer to hold password hashes they have no use
 * for and no reason to want.
 */
export const userRepository: UserRepository = isDatabaseConfigured()
  ? postgresUserRepository
  : memoryUserRepository;

export const otpRepository: OtpRepository = isDatabaseConfigured()
  ? postgresOtpRepository
  : memoryOtpRepository;

export const passwordResetRepository: PasswordResetRepository = isDatabaseConfigured()
  ? postgresPasswordResetRepository
  : memoryPasswordResetRepository;

/** True when accounts survive a restart. The console warns when they do not. */
export const accountsAreDurable = isDatabaseConfigured();

/** `embedded` (PGlite, in-process) or `postgres` (hosted). Shown in the console's setup panel. */
export const accountsBackend = databaseKind();
