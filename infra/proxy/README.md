# Terminador TLS de ensayo

La topología combina `docker-compose.yml`, `docker-compose.proxy-test.yml` y `docker-compose.proxy-tls-test.yml`. El API solo pertenece a `backend`; el terminador pertenece a `frontend` y `backend`; el cliente solo pertenece a `frontend`. El override no publica el API.

## Aprovisionamiento local

Generar una CA y un certificado exclusivo para `terra-link.test` fuera del repositorio:

```sh
openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt -days 1 -subj '/CN=Terra Link Test CA'
openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj '/CN=terra-link.test'
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days 1 -sha256 -extfile <(printf 'subjectAltName=DNS:terra-link.test\n')
```

Definir `TLS_TEST_CERT_DIR` apuntando a la carpeta temporal y ejecutar Compose con un nombre de proyecto exclusivo. `server.key`, la CA privada y los volúmenes son efímeros; no se versionan ni se copian a imágenes.

## Renovación

Generar un nuevo par antes de la expiración, validar la cadena desde un cliente que confíe en la CA autorizada y recrear únicamente el terminador. No sobrescribir claves en uso ni desactivar `rejectUnauthorized`; conservar el certificado anterior hasta completar la transición acordada.

El ensayo local no acredita dominio, CA ni renovación de producción. La política HTTP del ejemplo es redirección `308` a HTTPS; la exposición productiva debe limitarse al terminador autorizado.
