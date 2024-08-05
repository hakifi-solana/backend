import { InsuranceABI } from './abi/insurance.abi';
import type { Config } from './config.interface';

const config: Config = {
  nest: {
    port: parseInt(process.env.PORT, 10) || 3000,
    path: 'api',
  },
  cors: {
    enabled: true,
    origins: ['http://localhost:3000', 'http://localhost:3001'],
  },
  swagger: {
    enabled: true,
    title: 'Hakifi BE Service',
    description: 'Hakifi BE Service API description',
    version: '1.0',
    path: 'api/docs',
  },
  jwtSecretKey: process.env.JWT_SECRET_KEY || 'hakifi',
  security: {
    expiresIn: '7d',
    refreshIn: '7d',
    bcryptSaltOrRound: 10,
  },
  contract: {
    abi: InsuranceABI,
    address: process.env.INSURANCE_CONTRACT_ADDRESS,
    rpcHttpUrl: process.env.RPC_HTTP_URL,
    rpcWsUrl: process.env.RPC_WS_URL,
    modPrivateKey: process.env.MOD_PRIVATE_KEY,
  },
  redisUrl: process.env.REDIS_URL,
};

export default (): Config => config;
