"""저장소 사용량 — 객체 저장소(MinIO)를 직접 세어 실제 바이트를 낸다.

**행 수(/catalog/volume)와 다른 질문이다.** 행 수는 «데이터가 얼마나 있나», 여기는
«디스크를 얼마나 쓰고 있나» 다. 이전 스냅샷과 고아 파일이 남을 수 있어 둘은 비례하지 않는다.

재는 방법
  · **점유(bytes)** — S3 ListObjectsV2 로 버킷을 훑어 접두사별로 더한다.
    이전 스냅샷·고아 파일까지 세려면 저장소 자체를 봐야 한다.
  · **현재(liveBytes)** — 지금 스냅샷이 가리키는 데이터 파일만 골라
    (warehouse.data_files) 위에서 얻은 크기를 맞춰 더한다.

둘의 차이가 곧 스냅샷 만료와 고아 파일 정리로 회수할 수 있는 용량이다.

카탈로그를 거치지 않고 S3 를 직접 보는 이유는, 카탈로그가 아는 것은 등록된
테이블뿐이라 지워진 테이블의 잔여 파일과 관측(Elementary) 테이블이 빠지기
때문이다. 저장소 사용량은 «남아 있는 전부» 를 말해야 쓸모가 있다.

"""

from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, Query

from .. import manifest, warehouse
from ..config import dbt_env
from ..errors import ApiError

router = APIRouter(tags=["storage"])

# docker-compose 가 만드는 두 버킷. warehouse 는 Iceberg 테이블, landing 은 원천 CSV.
WAREHOUSE_BUCKET = "warehouse"
LANDING_BUCKET = "landing"

# 관측용 스키마 — dbt 가 아니라 Elementary 패키지가 만든다. 카탈로그에 없는 게
# 정상이므로 «고아» 로 몰면 안 된다. 여기만 분리해 따로 센다.
OBSERVABILITY = ("analytics_elementary", "analytics_test_failures")

# 훑는 데 1초 남짓 든다. 홈이 그릴 때마다 훑지 않도록 짧게 캐시한다.
# 적재·빌드는 분 단위라 5분이면 화면이 뒤처지지 않는다.
_CACHE: dict[str, Any] = {"at": 0.0, "data": None}
_TTL = 300.0


def _client() -> Any:
    try:
        import boto3
    except ImportError as e:      # pragma: no cover
        raise ApiError("UPSTREAM_UNAVAILABLE",
                       "저장소 조회 라이브러리(boto3)가 설치되어 있지 않습니다. "
                       "pip install boto3 후 다시 시도해 주세요.",
                       status=503) from e
    env = dbt_env()
    return boto3.client(
        "s3",
        endpoint_url=env.get("MINIO_ENDPOINT", "http://localhost:9000"),
        aws_access_key_id=env.get("MINIO_ROOT_USER", "minioadmin"),
        aws_secret_access_key=env.get("MINIO_ROOT_PASSWORD", "minioadmin"),
        region_name="us-east-1")


def _scan(s3: Any, bucket: str, keep_paths: bool = True) -> tuple[dict[str, int], int, int]:
    """버킷을 한 번 훑어 (경로→크기, 총 바이트, 객체 수).

    keep_paths=False 면 합계만 낸다. 경로별 크기는 현재 스냅샷을 맞춰 볼 때만
    필요한데, 그럴 일이 없는 버킷(landing)까지 전 객체를 사전에 담으면 파일이
    쌓일수록 메모리만 먹는다.
    """
    sizes: dict[str, int] = {}
    total = objects = 0
    try:
        for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket):
            for o in page.get("Contents", []):
                if keep_paths:
                    sizes[f"s3://{bucket}/{o['Key']}"] = o["Size"]
                total += o["Size"]
                objects += 1
    except Exception as e:      # noqa: BLE001
        raise ApiError("UPSTREAM_UNAVAILABLE",
                       f"저장소({bucket})를 읽지 못했습니다. MinIO 가 떠 있는지 확인해 주세요.",
                       {"error": str(e)[:400]}, status=503) from e
    return sizes, total, objects


# DuckLake 는 데이터 파일을 이 접두사 아래에 둔다 — s3://warehouse/ducklake/…
DUCKLAKE_ROOT = "ducklake"
# dbt 의 table materialization 이 만드는 임시 이름. 만들 때 <모델>__dbt_tmp 로 쓰고
# 이름만 바꾸는데, DuckLake 파일은 불변이라 **처음 쓴 디렉터리에 그대로 남는다.**
_TMP_SUFFIX = "__dbt_tmp"


def _split(key: str) -> tuple[str, str, str] | None:
    """객체 키 → (schema, table, area). 못 가르면 None(테이블 파일이 아니다).

    Iceberg와 DuckLake 레이아웃을 모두 지원한다.

      Iceberg   <schema>/<table>/{data,metadata}/…
      DuckLake  ducklake/<schema>/<table>/<파일>.parquet
    """
    parts = key.split("/")
    if parts and parts[0] == DUCKLAKE_ROOT:
        if len(parts) < 4:
            return None
        schema, table = parts[1], parts[2]
        # __dbt_tmp 를 떼지 않으면 모델마다 «유령 테이블» 이 하나씩 더 생기고,
        # 그 유령은 카탈로그에 없으니 또 고아로 잡힌다.
        if table.endswith(_TMP_SUFFIX):
            table = table[: -len(_TMP_SUFFIX)]
        return schema, table, "data"
    if len(parts) < 3:
        return None          # 버킷 바로 밑의 파일 — 테이블이 아니다
    return parts[0], parts[1], parts[2]


def _kind(schema: str, table: str, phys: str, known: set[str]) -> str:
    if phys in known:
        return "catalog"
    if "__tmp_" in table:
        return "temp"
    if schema in OBSERVABILITY:
        return "observability"
    # 카탈로그에도 없고 관측도 아니다 — 지워진 모델이 남긴 파일이다.
    return "orphan"


@router.get("/storage")
def storage(refresh: bool = Query(False, description="캐시를 무시하고 다시 센다")) -> dict[str, Any]:
    now = time.time()
    if not refresh and _CACHE["data"] and now - _CACHE["at"] < _TTL:
        return _CACHE["data"]

    s3 = _client()
    sizes, total, objects = _scan(s3, WAREHOUSE_BUCKET)

    entries = {e["phys"]: e for e in manifest.all_entries().values()}

    # 객체 경로를 schema/table 로 접어 모은다 (_split 이 두 레이아웃을 다 읽는다).
    tables: dict[str, dict[str, Any]] = {}
    prefix = f"s3://{WAREHOUSE_BUCKET}/"
    for path, size in sizes.items():
        split = _split(path[len(prefix):])
        if split is None:
            continue
        schema, table, area = split
        t = tables.setdefault(f"{schema}.{table}", {
            "schema": schema, "table": table, "bytes": 0, "objects": 0,
            "dataBytes": 0, "metadataBytes": 0})
        t["bytes"] += size
        t["objects"] += 1
        t["dataBytes" if area == "data" else "metadataBytes"] += size

    for phys, e in entries.items():
        t = tables.get(phys)
        if t is None:
            # 아직 한 번도 만들어지지 않은 테이블. 0 이 아니라 «없음» 으로 둔다.
            tables[phys] = {"schema": phys.split(".")[0], "table": phys.split(".")[-1],
                            "bytes": 0, "objects": 0, "dataBytes": 0, "metadataBytes": 0,
                            "liveBytes": None}
            continue
        by_file = warehouse.file_sizes(phys)
        t["liveBytes"] = None if by_file is None else sum(by_file.values())

    items = []
    for phys, t in tables.items():
        e = entries.get(phys)
        kind = _kind(t["schema"], t["table"], phys, set(entries))
        live = t.get("liveBytes")
        items.append({
            **t, "phys": phys, "kind": kind,
            "id": e["id"] if e else None,
            "name": e["name"] if e else t["table"],
            "group": e["group"] if e else None,
            "liveBytes": live,
            "staleBytes": None if live is None else max(0, t["bytes"] - live),
        })
    items.sort(key=lambda x: -x["bytes"])

    def total_of(kind: str) -> dict[str, Any]:
        rs = [i for i in items if i["kind"] == kind]
        return {"bytes": sum(i["bytes"] for i in rs), "tables": len(rs),
                "objects": sum(i["objects"] for i in rs)}

    # 네임스페이스(= Iceberg 스키마)별 집계. 화면이 기본으로 보는 축이다 —
    # 사람이 «내 데이터가 어디에 얼마나 있나» 를 묻는 단위가 네임스페이스다.
    by_schema: dict[str, dict[str, Any]] = {}
    for i in items:
        b = by_schema.setdefault(i["schema"], {
            "schema": i["schema"], "bytes": 0, "liveBytes": 0, "liveKnown": 0,
            "tables": 0, "catalogTables": 0, "objects": 0})
        b["bytes"] += i["bytes"]
        b["tables"] += 1
        b["objects"] += i["objects"]
        if i["kind"] == "catalog":
            b["catalogTables"] += 1
        if i["liveBytes"] is not None:
            b["liveBytes"] += i["liveBytes"]
            b["liveKnown"] += 1
    for b in by_schema.values():
        # 현재 스냅샷을 물어볼 수 있는 테이블이 하나도 없는 네임스페이스(관측·잔여)는
        # 합계 0 이 아니라 «모른다» 다. 0 으로 두면 «지금 쓰는 게 없다» 로 읽힌다.
        if not b.pop("liveKnown"):
            b["liveBytes"] = None
        # 이 플랫폼이 관리하는 네임스페이스인가. dbt 가 만든 테이블이 하나라도
        # 있으면 «주», 없으면 남의 것이다(Elementary 의 관측 스키마 등).
        # 화면은 주 네임스페이스만 이름으로 세우고 나머지를 «기타» 로 접는다.
        b["primary"] = b["catalogTables"] > 0

    cat = [i for i in items if i["kind"] == "catalog"]
    live_total = sum(i["liveBytes"] or 0 for i in cat)
    stale = max(0, sum(i["bytes"] for i in cat) - live_total)

    # landing 은 수집이 내려받은 원본이다. 웨어하우스와 성격이 달라 섞지 않고 따로 낸다.
    _, l_total, l_objects = _scan(s3, LANDING_BUCKET, keep_paths=False)

    data = {
        "bucket": WAREHOUSE_BUCKET,
        "totalBytes": total,
        "objects": objects,
        # 카탈로그 테이블 기준. 저장소 전체가 아니라 «지금 쓰이는 데이터» 다.
        "liveBytes": live_total,
        "staleBytes": stale,
        "reclaimable": {
            "stale": stale,
            "temp": total_of("temp")["bytes"],
            "orphan": total_of("orphan")["bytes"],
            "total": stale + total_of("temp")["bytes"] + total_of("orphan")["bytes"],
        },
        "catalog": total_of("catalog"),
        "observability": total_of("observability"),
        "temp": total_of("temp"),
        "orphan": total_of("orphan"),
        "bySchema": sorted(by_schema.values(), key=lambda x: -x["bytes"]),
        "items": items,
        "landing": {"bucket": LANDING_BUCKET, "bytes": l_total, "objects": l_objects},
        "measuredAt": now,
        "note": "점유는 객체 저장소 실측입니다. 현재 스냅샷과의 차이는 "
                "Iceberg 가 남겨 둔 지난 판본으로, 스냅샷을 만료하면 회수됩니다.",
    }
    _CACHE.update(at=now, data=data)
    return data
