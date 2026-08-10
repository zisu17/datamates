{% test not_in_future(model, column_name, tolerance_days=0) %}

-- 커스텀 제네릭 테스트.
-- 날짜/타임스탬프 컬럼이 오늘 + tolerance_days 를 넘어서면 해당 행을 반환한다(= 실패).
-- 반환 행이 0건이면 통과한다는 것이 dbt 데이터 테스트의 규약이다.

select
    {{ column_name }} as offending_value
from {{ model }}
where {{ column_name }} > date_add(current_date(), {{ tolerance_days }})

{% endtest %}
