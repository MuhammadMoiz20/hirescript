"""S3/MinIO-compatible object storage helpers."""

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

from app.config import settings


_PDF_CONTENT_TYPE = "application/pdf"


def _client():
    return boto3.client(
        "s3",
        endpoint_url=settings.storage_endpoint_url,
        aws_access_key_id=settings.storage_access_key,
        aws_secret_access_key=settings.storage_secret_key,
        region_name=settings.storage_region,
        config=Config(signature_version="s3v4"),
    )


def ensure_bucket(bucket: str | None = None) -> None:
    bucket = bucket or settings.storage_bucket
    s3 = _client()
    try:
        s3.head_bucket(Bucket=bucket)
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        if code in {"404", "NoSuchBucket", "NotFound"}:
            s3.create_bucket(Bucket=bucket)
        else:
            raise


def put_pdf(*, key: str, data: bytes, bucket: str | None = None) -> None:
    bucket = bucket or settings.storage_bucket
    _client().put_object(Bucket=bucket, Key=key, Body=data, ContentType=_PDF_CONTENT_TYPE)


def get_pdf(*, key: str, bucket: str | None = None) -> bytes:
    bucket = bucket or settings.storage_bucket
    obj = _client().get_object(Bucket=bucket, Key=key)
    return obj["Body"].read()


def presign_get(*, key: str, ttl_seconds: int = 600, bucket: str | None = None) -> str:
    bucket = bucket or settings.storage_bucket
    return _client().generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=ttl_seconds,
    )
