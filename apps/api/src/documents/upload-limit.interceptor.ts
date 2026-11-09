import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import multer from 'multer';
import { Observable } from 'rxjs';
import { APP_CONFIG, type AppConfig } from '../config';
import { AppError } from '../common/errors';

// Recepción de archivos con el límite CONFIGURADO de documentos (no un tope fijo mayor): multer corta el
// flujo al superar `documents.maxBytes`, así que nunca se acumulan en memoria más bytes que el máximo
// permitido (+1). Un único archivo y campos de texto acotados.
@Injectable()
export class DocumentUploadInterceptor implements NestInterceptor {
  private readonly handler: ReturnType<ReturnType<typeof multer>['single']>;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.handler = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: config.documents.maxBytes, files: 1, fields: 20, fieldSize: 4096, parts: 25 },
    }).single('file');
    this.maxBytes = config.documents.maxBytes;
  }

  private readonly maxBytes: number;

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    return new Observable((subscriber) => {
      this.handler(req, res, (err?: unknown) => {
        if (err) {
          const code = (err as { code?: string }).code;
          subscriber.error(code === 'LIMIT_FILE_SIZE'
            ? new AppError(422, 'FILE_TOO_LARGE', `El archivo supera el límite de ${this.maxBytes} bytes.`, [{ field: 'file', reason: 'TOO_LARGE' }])
            : new AppError(400, 'VALIDATION_FAILED', 'La carga no es válida (un solo archivo y campos acotados).', [{ field: 'file', reason: code ?? 'INVALID_MULTIPART' }]));
          return;
        }
        next.handle().subscribe(subscriber);
      });
    });
  }
}
