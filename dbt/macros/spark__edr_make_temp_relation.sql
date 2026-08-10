{% macro spark__edr_make_temp_relation(base_relation, suffix) %}
    {#-
        elementary 가 중간 테이블을 만들 때 쓰는 relation 을 Spark + Iceberg REST 카탈로그에
        맞게 교정한다.

        문제:
          elementary 의 default__edr_make_temp_relation 은 dbt.make_temp_relation 을 그대로
          호출한다. 그런데 dbt-spark 의 spark__make_temp_relation 은
              tmp_relation.include(database=false, schema=false)
          로 스키마를 떼어낸 relation 을 돌려준다. Spark 의 CREATE TEMPORARY VIEW 는 세션
          스코프의 비수식 이름이라 그게 맞는 동작이다.

          하지만 elementary 는 이 relation 으로 **실제 테이블**을 만든다. Iceberg REST
          카탈로그는 네임스페이스가 없는 식별자를 거부하므로
              NoSuchTableException: Invalid table identifier: dbt_models__tmp_20260804012041531714
          로 죽는다. (파일 기반 hadoop 카탈로그나 Hive 에서는 현재 DB 로 해석돼 넘어간다.)

        해결:
          elementary 패키지 스키마로 수식된 relation 을 돌려준다.
          dbt_project.yml 의 dispatch 설정이 이 매크로를 elementary 의 기본 구현보다
          먼저 찾도록 해준다.
    -#}

    {% if not suffix %}
        {% set suffix = elementary.get_timestamped_table_suffix() %}
    {% endif %}

    {% set package_database, package_schema = (
        elementary.get_package_database_and_schema()
    ) %}

    {#- 호출부가 Relation 이 아니라 노드(dict)를 넘기는 경우가 있다. -#}
    {% if base_relation is mapping %}
        {% set base_identifier = (
            base_relation.get("alias") or base_relation.get("name") or "edr_tmp"
        ) %}
        {% set base_schema = base_relation.get("schema") %}
    {% else %}
        {% set base_identifier = base_relation.identifier %}
        {% set base_schema = base_relation.schema %}
    {% endif %}

    {% set tmp_identifier = elementary.table_name_with_suffix(
        base_identifier, suffix
    ) %}

    {#- dbt-spark 는 2단계 이름(schema.identifier)만 쓰므로 database 는 비운다. -#}
    {% set tmp_relation = api.Relation.create(
        database=none,
        schema=package_schema or base_schema or target.schema,
        identifier=tmp_identifier,
        type="table",
    ) %}

    {% do return(tmp_relation) %}
{% endmacro %}
