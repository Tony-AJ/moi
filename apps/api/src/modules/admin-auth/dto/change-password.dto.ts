import { IsString, Length } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @Length(8, 128)
  currentPassword!: string;

  @IsString()
  @Length(10, 128, { message: 'New password must be at least 10 characters' })
  newPassword!: string;
}
