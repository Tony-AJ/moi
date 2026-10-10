import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'Enter a valid email address' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email!: string;

  @IsString()
  @Length(8, 128)
  password!: string;
}
