import {
  Body,
  Controller,
  Get,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Actor, AuthRequest, CurrentUser, Roles } from "../../common/http";
import { FilesModule } from "../materials/files.module";
import { UserManagementService } from "./user-management.service";
import {
  UserQuery,
  UserCreateDto,
  ProfileEditDto,
  RoleChangeDto,
  PasswordResetDto,
} from "./user-management.dto";
@ApiTags("admin-users")
@Roles("SUPERADMIN")
@Controller("admin/users")
export class UserManagementController {
  constructor(private service: UserManagementService) {}
  @Get() list(@Query() q: UserQuery) {
    return this.service.list(q);
  }
  @Get(":id") get(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }
  @Post() create(
    @CurrentUser() a: Actor,
    @Body() d: UserCreateDto,
    @Req() r: AuthRequest,
  ) {
    return this.service.create(a, d, r.requestId);
  }
  @Patch(":id") update(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() a: Actor,
    @Body() d: ProfileEditDto,
    @Req() r: AuthRequest,
  ) {
    return this.service.update(id, a, d, r.requestId);
  }
  @Post(":id/role") role(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() a: Actor,
    @Body() d: RoleChangeDto,
    @Req() r: AuthRequest,
  ) {
    return this.service.role(id, a, d.role, r.requestId);
  }
  @Post(":id/password") reset(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() a: Actor,
    @Body() d: PasswordResetDto,
    @Req() r: AuthRequest,
  ) {
    return this.service.reset(id, a, d, r.requestId);
  }
}
@Module({
  imports: [FilesModule],
  controllers: [UserManagementController],
  providers: [UserManagementService],
})
export class UserManagementModule {}
