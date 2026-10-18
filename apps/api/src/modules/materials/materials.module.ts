import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import {
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
  PartialType,
} from "@nestjs/swagger";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Length,
  Max,
  Min,
} from "class-validator";
import { Database } from "../../infrastructure/database/database.module";
import {
  Actor,
  CurrentUser,
  PageDto,
  paged,
  pageArgs,
  Roles,
} from "../../common/http";
import { CoursesModule, CoursesService } from "../courses/courses.module";
import {
  EnrollmentsModule,
  EnrollmentsService,
} from "../enrollments/enrollments.module";
import { FilesModule, FilesService } from "./files.module";
export class MaterialDto {
  @ApiProperty() @IsString() @Length(2, 160) title!: string;
  @ApiProperty({ enum: ["file", "link"] }) @IsIn(["file", "link"]) kind!:
    "file" | "link";
  @ApiPropertyOptional() @IsOptional() @IsUUID() fileAssetId?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ protocols: ["https"], require_protocol: true })
  url?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  position?: number;
}
export class UpdateMaterialDto extends PartialType(MaterialDto) {}
@Injectable()
export class MaterialsRepository {
  constructor(private db: Database) {}
  get(id: string) {
    return this.db.material.findFirstOrThrow({
      where: { id, deletedAt: null },
    });
  }
  create(courseId: string, data: MaterialDto) {
    return this.db.material.create({ data: { ...data, courseId } });
  }
  update(id: string, data: UpdateMaterialDto & { deletedAt?: Date }) {
    return this.db.material.update({ where: { id }, data });
  }
  async list(courseId: string, q: PageDto) {
    const where = { courseId, deletedAt: null };
    const [items, total] = await Promise.all([
      this.db.material.findMany({
        where,
        ...pageArgs(q),
        orderBy: [{ position: "asc" }, { id: "asc" }],
      }),
      this.db.material.count({ where }),
    ]);
    return paged(items, total, q);
  }
}
@Injectable()
export class MaterialsService {
  constructor(
    private repo: MaterialsRepository,
    private courses: CoursesService,
    private enrollments: EnrollmentsService,
    private files: FilesService,
  ) {}
  async list(courseId: string, a: Actor, q: PageDto) {
    await this.enrollments.assertAccess(a, courseId);
    return this.repo.list(courseId, q);
  }
  private async validate(dto: MaterialDto, a: Actor) {
    if (dto.kind === "file") {
      if (!dto.fileAssetId || dto.url)
        throw new BadRequestException("Укажите файл");
      await this.files.assertOwned(dto.fileAssetId, a.id, "material");
    } else if (!dto.url || dto.fileAssetId)
      throw new BadRequestException("Укажите ссылку");
  }
  async create(courseId: string, a: Actor, dto: MaterialDto) {
    await this.courses.owned(courseId, a);
    await this.validate(dto, a);
    return this.repo.create(courseId, dto);
  }
  async update(id: string, a: Actor, dto: UpdateMaterialDto) {
    const m = await this.repo.get(id);
    await this.courses.owned(m.courseId, a);
    await this.validate(
      {
        ...m,
        fileAssetId: m.fileAssetId ?? undefined,
        url: m.url ?? undefined,
        ...dto,
      },
      a,
    );
    return this.repo.update(id, dto);
  }
  async remove(id: string, a: Actor) {
    const m = await this.repo.get(id);
    await this.courses.owned(m.courseId, a);
    return this.repo.update(id, { deletedAt: new Date() });
  }
}
@ApiTags("materials")
@Controller()
export class MaterialsController {
  constructor(private service: MaterialsService) {}
  @Get("courses/:id/materials") list(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() a: Actor,
    @Query() q: PageDto,
  ) {
    return this.service.list(id, a, q);
  }
  @Roles("tutor") @Post("courses/:id/materials") create(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() a: Actor,
    @Body() dto: MaterialDto,
  ) {
    return this.service.create(id, a, dto);
  }
  @Roles("tutor") @Patch("materials/:id") update(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() a: Actor,
    @Body() dto: UpdateMaterialDto,
  ) {
    return this.service.update(id, a, dto);
  }
  @Roles("tutor") @Delete("materials/:id") remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() a: Actor,
  ) {
    return this.service.remove(id, a);
  }
}
@Module({
  imports: [CoursesModule, EnrollmentsModule, FilesModule],
  controllers: [MaterialsController],
  providers: [MaterialsRepository, MaterialsService],
})
export class MaterialsModule {}
