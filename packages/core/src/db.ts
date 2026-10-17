import { config } from 'dotenv';
import { root } from './storage';
import path from 'node:path';
config({ path: path.join(root, '.env'), quiet: true });
import { readFileSync } from 'node:fs';
if (process.env.DATABASE_URL_FILE)
  process.env.DATABASE_URL = readFileSync(process.env.DATABASE_URL_FILE, 'utf8').trim();
if(process.env.DATABASE_URL){const url=new URL(process.env.DATABASE_URL);for(const [key,value]of Object.entries({connection_limit:'4',connect_timeout:'5',pool_timeout:'5',socket_timeout:'20'}))if(!url.searchParams.has(key))url.searchParams.set(key,value);process.env.DATABASE_URL=url.href;}
import { PrismaClient } from '@prisma/client';
const globalDb = globalThis as unknown as { prisma?: PrismaClient };
export const db = globalDb.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalDb.prisma = db;
