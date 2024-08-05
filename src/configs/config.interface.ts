export interface Config {
  nest: NestConfig;
  cors: CorsConfig;
  swagger: SwaggerConfig;
  security: SecurityConfig;
  jwtSecretKey: string;
  contract: ContractConfig;
  redisUrl: string;
}

export interface ContractConfig {
  address: string;
  abi: any;
  rpcHttpUrl: string;
  rpcWsUrl: string;
  modPrivateKey: string;
}

export interface NestConfig {
  port: number;
  path: string;
}

export interface CorsConfig {
  enabled: boolean;
  origins: string[];
}

export interface SwaggerConfig {
  enabled: boolean;
  title: string;
  description: string;
  version: string;
  path: string;
}

export interface SecurityConfig {
  expiresIn: string;
  refreshIn: string;
  bcryptSaltOrRound: string | number;
}
