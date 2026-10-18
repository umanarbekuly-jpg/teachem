import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from "@nestjs/common";
import { ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from "class-validator";
import { Prisma } from "@prisma/client";
import {
  Actor,
  CurrentUser,
  pageArgs,
  paged,
  Public,
  Roles,
} from "../../common/http";
import { Database } from "../../infrastructure/database/database.module";
import { CoursesModule, CoursesService } from "../courses/courses.module";
import { CourseQuery } from "../courses/courses.dto";
import { FilesModule, FilesService } from "../materials/files.module";
export class ProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 5000)
  bio?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  education?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(80)
  experienceYears?: number;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Length(1, 100, { each: true })
  subjects?: string[];
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Length(1, 100, { each: true })
  languages?: string[];
  @ApiPropertyOptional() @IsOptional() @IsUUID() photoAssetId?: string;
}
@Injectable()
export class TutorsRepository {
  constructor(private db: Database) {}
  async list(q: CourseQuery, ids?: string[]) {
    const where: Prisma.TutorProfileWhereInput = {
      user: {
        role: "tutor",
        blockedAt: null,
        deletedAt: null,
        ...(q.search
          ? { name: { contains: q.search, mode: "insensitive" } }
          : {}),
      },
      ...(ids ? { userId: { in: ids } } : {}),
      ...(q.subject ? { subjects: { has: q.subject } } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.tutorProfile.findMany({
        where,
        ...pageArgs(q),
        include: { user: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
      }),
      this.db.tutorProfile.count({ where }),
    ]);
    return paged(items, total, q);
  }
  get(userId: string) {
    return this.db.tutorProfile.findFirstOrThrow({
      where: { userId, user: { blockedAt: null, deletedAt: null } },
      include: { user: { select: { id: true, name: true } } },
    });
  }
  mine(userId: string) {
    return this.db.tutorProfile.upsert({
      where: { userId },
      create: { userId, subjects: [], languages: [] },
      update: {},
      include: { user: { select: { id: true, name: true } } },
    });
  }
  update(userId: string, dto: ProfileDto) {
    return this.db.tutorProfile.upsert({
      where: { userId },
      create: { userId, subjects: [], languages: [], ...dto },
      update: dto,
      include: { user: { select: { id: true, name: true } } },
    });
  }
}
@Injectable()
export class TutorsService {
  constructor(
    private repo: TutorsRepository,
    private courses: CoursesService,
    private files: FilesService,
  ) {}
  async list(q: CourseQuery) {
    const ids =
      q.priceFromMinor !== undefined || q.priceToMinor !== undefined
        ? (await this.courses.tutorIds(q)).map((c) => c.tutorId)
        : undefined;
    return this.repo.list(q, ids);
  }
  async get(id: string) {
    const profile = await this.repo.get(id);
    return {
      ...profile,
      photoUrl: profile.photoAssetId
        ? await this.files.avatar(profile.photoAssetId)
        : null,
    };
  }
  mine(a: Actor) {
    return this.repo.mine(a.id);
  }
  async update(a: Actor, dto: ProfileDto) {
    if (dto.photoAssetId)
      await this.files.assertOwned(dto.photoAssetId, a.id, "avatar");
    return this.repo.update(a.id, dto);
  }
}
@ApiTags("tutors")
@Controller("tutors")
export class TutorsController {
  constructor(private service: TutorsService) {}
  @Roles("tutor") @Get("me/profile") mine(@CurrentUser() a: Actor) {
    return this.service.mine(a);
  }
  @Roles("tutor") @Patch("me/profile") update(
    @CurrentUser() a: Actor,
    @Body() dto: ProfileDto,
  ) {
    return this.service.update(a, dto);
  }
  @Public() @Get() list(@Query() q: CourseQuery) {
    return this.service.list(q);
  }
  @Public() @Get(":id") get(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }
}
@Module({
  imports: [CoursesModule, FilesModule],
  controllers: [TutorsController],
  providers: [TutorsRepository, TutorsService],
})
export class TutorsModule {}
