import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min, Length } from 'class-validator';

/** Período de los indicadores de actividad. Fechas ISO (YYYY-MM-DD); ambas opcionales y sin límite por defecto. */
export class ReportPeriodDto {
  @ApiPropertyOptional({ example: '2026-09-01', description: 'Inicio del período (inclusive) para los indicadores de actividad.' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from debe tener el formato YYYY-MM-DD.' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30', description: 'Fin del período (inclusive) para los indicadores de actividad.' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to debe tener el formato YYYY-MM-DD.' })
  to?: string;
}

/**
 * Período de comparación para los indicadores de ACTIVIDAD (P0-030). Comparar actividad entre dos períodos usa las
 * fechas operativas declaradas; NO reconstruye existencias ni saldos a una fecha, que es otra capacidad y tiene su
 * propio contrato pendiente.
 */
export class ReportCompareDto extends ReportPeriodDto {
  @ApiPropertyOptional({ example: '2026-08-01', description: 'Inicio del período de comparación (inclusive).' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'compare_from debe tener el formato YYYY-MM-DD.' })
  compare_from?: string;

  @ApiPropertyOptional({ example: '2026-08-31', description: 'Fin del período de comparación (inclusive).' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'compare_to debe tener el formato YYYY-MM-DD.' })
  compare_to?: string;
}

/** Paginación por cursor sobre la clave natural del reporte (convención de listados del repositorio). */
export class ReportPageDto extends ReportPeriodDto {
  @ApiPropertyOptional({ description: 'Clave natural de la última fila recibida; devuelve las siguientes.' })
  @IsOptional()
  @Length(1, 128)
  cursor?: string;

  @ApiPropertyOptional({ description: 'Filas por página (máximo 500).', minimum: 1, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit debe ser un entero.' })
  @Min(1)
  @Max(500)
  limit?: number;
}
