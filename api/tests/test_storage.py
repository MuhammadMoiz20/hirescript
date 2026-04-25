import uuid
import pytest
from app.services.storage import put_pdf, get_pdf, presign_get, ensure_bucket


@pytest.fixture(scope="module")
def bucket():
    name = f"hirescript-test-{uuid.uuid4().hex[:8]}"
    ensure_bucket(bucket=name)
    yield name
    # best-effort cleanup
    import boto3
    from botocore.client import Config
    from app.config import settings
    s3 = boto3.client(
        "s3",
        endpoint_url=settings.storage_endpoint_url,
        aws_access_key_id=settings.storage_access_key,
        aws_secret_access_key=settings.storage_secret_key,
        region_name=settings.storage_region,
        config=Config(signature_version="s3v4"),
    )
    objs = s3.list_objects_v2(Bucket=name).get("Contents", [])
    if objs:
        s3.delete_objects(Bucket=name, Delete={"Objects": [{"Key": o["Key"]} for o in objs]})
    s3.delete_bucket(Bucket=name)


def test_put_then_get_round_trip(bucket):
    put_pdf(key="versions/1.pdf", data=b"%PDF-1.4 hello", bucket=bucket)
    out = get_pdf(key="versions/1.pdf", bucket=bucket)
    assert out == b"%PDF-1.4 hello"


def test_presign_get_returns_url(bucket):
    put_pdf(key="versions/2.pdf", data=b"%PDF-1.4", bucket=bucket)
    url = presign_get(key="versions/2.pdf", bucket=bucket)
    assert url.startswith("http")
    assert bucket in url
    assert "X-Amz-Signature" in url or "Signature" in url


def test_get_missing_key_raises(bucket):
    from botocore.exceptions import ClientError
    with pytest.raises(ClientError):
        get_pdf(key="versions/does-not-exist.pdf", bucket=bucket)


def test_ensure_bucket_idempotent():
    name = f"hirescript-test-idem-{uuid.uuid4().hex[:8]}"
    ensure_bucket(bucket=name)
    ensure_bucket(bucket=name)  # should not raise on second call
    # cleanup
    import boto3
    from botocore.client import Config
    from app.config import settings
    s3 = boto3.client(
        "s3", endpoint_url=settings.storage_endpoint_url,
        aws_access_key_id=settings.storage_access_key,
        aws_secret_access_key=settings.storage_secret_key,
        region_name=settings.storage_region, config=Config(signature_version="s3v4"),
    )
    s3.delete_bucket(Bucket=name)
