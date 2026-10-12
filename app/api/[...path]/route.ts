import { env } from 'cloudflare:workers';
import { handleApi } from '@/lib/commerce/api';
import type { RuntimeEnv } from '@/lib/commerce/types';
export const dynamic='force-dynamic';
export const GET = (request:Request)=>handleApi(request,env as RuntimeEnv);
export const POST = GET;
export const PATCH = GET;
export const DELETE = GET;
