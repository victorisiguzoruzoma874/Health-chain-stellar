import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  Inject,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { JwtPayload } from './jwt.strategy';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { randomBytes } from 'crypto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async validateUser(email: string, password: string): Promise<unknown> {
    // TODO: Query user from DB and verify hashed password
    void email;
    void password;
    return null;
  }

  async login(loginDto: { email: string; password: string; role?: string }) {
    // TODO: Replace with real user lookup + bcrypt comparison
    const payload: JwtPayload = {
      sub: 'placeholder-user-id',
      email: loginDto.email,
      role: loginDto.role ?? 'donor',
    };

    const accessToken = this.jwtService.sign(
      payload as unknown as Record<string, unknown>,
    );
    const refreshToken = await this.generateRefreshToken(payload);

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
    };
  }

  async register(registerDto: {
    email: string;
    password: string;
    role?: string;
    name?: string;
  }) {
    // TODO: Hash password and persist user in DB; check for duplicate emails
    void registerDto;
    throw new ConflictException('Registration not yet implemented');
  }

  async refreshToken(refreshToken: string) {
    try {
      const payload = this.jwtService.verify<JwtPayload>(refreshToken, {
        secret: this.configService.get<string>(
          'JWT_REFRESH_SECRET',
          'refresh-secret',
        ),
      });

      // Atomic consumption using Redis SET NX
      // Use the refresh token itself as the key (or its hash if it's extremely long)
      const tokenKey = `refresh_token:${refreshToken}`;
      const expiresAt = payload.exp
        ? payload.exp - Math.floor(Date.now() / 1000)
        : 604800;
      const ttl = Math.max(expiresAt, 0);

      // set(key, value, 'EX', ttl, 'NX') returns 'OK' if set, null if exists
      const consumed = await this.redis.set(
        tokenKey,
        '1',
        'EX',
        ttl || 604800,
        'NX',
      );

      if (!consumed) {
        this.logger.warn(
          `Replay attack detected for user ${payload.email}. Token already consumed.`,
        );
        throw new UnauthorizedException('INVALID_REFRESH_TOKEN');
      }

      this.logger.log(
        `Refresh token consumed for user ${payload.email}. Rotating tokens.`,
      );

      const newPayload: JwtPayload = {
        sub: payload.sub,
        email: payload.email,
        role: payload.role,
      };

      const newAccessToken = this.jwtService.sign(newPayload);
      const newRefreshToken = await this.generateRefreshToken(newPayload);

      return {
        access_token: newAccessToken,
        refresh_token: newRefreshToken,
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      this.logger.error(`Refresh token failed: ${error.message}`);
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  private async generateRefreshToken(payload: JwtPayload): Promise<string> {
    const jti = randomBytes(16).toString('hex');
    const refreshExpiresIn =
      this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d';

    const refreshToken = this.jwtService.sign(
      { ...payload, jti } as unknown as Record<string, unknown>,
      {
        secret:
          this.configService.get<string>('JWT_REFRESH_SECRET') ??
          'refresh-secret',

        expiresIn: refreshExpiresIn as any,
      },
    );

    return refreshToken;
  }

  async logout(userId: string) {
    // TODO: Blacklist the token / clear refresh token from DB
    void userId;
    return { message: 'Logged out successfully' };
  }
}
