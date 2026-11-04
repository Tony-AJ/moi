import { Body, Controller, Get, Ip, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { throttleConfig } from '../../common/throttle.config';
import { AdminAuthService } from './admin-auth.service';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { AdminAuthGuard } from '../../common/guards/admin-auth.guard';
import { CurrentAdmin, type AdminPrincipal } from '../../common/decorators/current-admin.decorator';
import { AllowPendingPassword } from '../../common/decorators/allow-pending-password.decorator';
import { PlatformAdminOnly } from '../../common/decorators/platform-admin.decorator';

@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @Post('login')
  @Throttle({
    default: { limit: throttleConfig.loginLimit, ttl: throttleConfig.globalTtlMs },
  })
  login(@Body() dto: LoginDto, @Ip() ip: string) {
    return this.auth.login(dto, ip);
  }

  @Get('me')
  @UseGuards(AdminAuthGuard)
  @AllowPendingPassword()
  me(@CurrentAdmin() admin: AdminPrincipal) {
    return this.auth.me(admin.id);
  }

  /**
   * Super admins only. Organizer passwords are set by the super admin
   * (POST /admin/platform/users/:id/reset-password), never by the organizer.
   */
  @Post('change-password')
  @UseGuards(AdminAuthGuard)
  @AllowPendingPassword()
  @PlatformAdminOnly()
  changePassword(
    @CurrentAdmin() admin: AdminPrincipal,
    @Body() dto: ChangePasswordDto,
    @Ip() ip: string,
  ) {
    return this.auth.changePassword(admin.id, dto, ip);
  }
}
