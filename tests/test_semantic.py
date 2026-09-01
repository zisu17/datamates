from __future__ import annotations

import unittest
from unittest.mock import patch

from datamates.app import semantic
from datamates.app.errors import ApiError
from datamates.app.routers import mart


ENTRY = {
    "id": "mart_sales", "name": "mart_sales", "kind": "model",
    "phys": "analytics.mart_sales", "desc": "dbt 설명", "tags": ["sales"],
    "downstream": [],
    "cols": [
        ["order_month", "주문 월", "DATE", "선택"],
        ["total_amount", "주문 금액", "DECIMAL", "선택"],
        ["customer_id", "고객 ID", "VARCHAR", "선택"],
    ],
    "col_desc": {"order_month": "주문이 발생한 월"},
}


class SemanticModelValidationTest(unittest.TestCase):
    @patch.object(semantic.manifest, "get", return_value=ENTRY)
    @patch.object(semantic.store, "marts", return_value=set())
    def test_only_data_mart_can_have_semantic_model(self, _marts, _get):
        with self.assertRaises(ApiError) as raised:
            semantic.save_model("mart_sales", {"businessName": "매출"})
        self.assertEqual(raised.exception.code, "SEMANTIC_MODEL_NOT_MART")

    @patch.object(semantic.manifest, "get", return_value=ENTRY)
    @patch.object(semantic.store, "marts", return_value={"mart_sales"})
    @patch.object(semantic.store, "semantic_model_get", return_value=None)
    def test_dimension_must_use_manifest_or_catalog_column(self, _get_sm, _marts, _get):
        body = {"businessName": "매출", "dimensions": [{
            "column": "missing_column", "businessName": "없는 차원",
        }]}
        with self.assertRaises(ApiError) as raised:
            semantic.save_model("mart_sales", body)
        self.assertEqual(raised.exception.code, "SEMANTIC_COLUMN_NOT_FOUND")

    @patch.object(semantic.manifest, "get", return_value=ENTRY)
    @patch.object(semantic.store, "marts", return_value={"mart_sales"})
    @patch.object(semantic.store, "semantic_measure_metric_refs",
                  return_value=[{"id": "mt_1", "metric_key": "total_sales"}])
    @patch.object(semantic.store, "semantic_model_get")
    def test_referenced_measure_cannot_be_removed(self, get_sm, _refs, _marts, _get):
        get_sm.return_value = {"model_id": "mart_sales", "fields": [{
            "id": "sf_measure", "kind": "measure", "column_name": "total_amount",
            "business_name": "매출", "aggregation": "SUM",
        }]}
        with self.assertRaises(ApiError) as raised:
            semantic.save_model("mart_sales", {
                "businessName": "매출", "entities": [], "dimensions": [], "measures": [],
            })
        self.assertEqual(raised.exception.code, "SEMANTIC_MEASURE_IN_USE")
        self.assertEqual(raised.exception.status, 409)

    @patch.object(semantic.manifest, "get", return_value=ENTRY)
    @patch.object(semantic.store, "marts", return_value={"mart_sales"})
    @patch.object(semantic.store, "semantic_model_get", return_value=None)
    @patch.object(semantic.store, "semantic_measure_metric_refs", return_value=[])
    @patch.object(semantic.store, "semantic_model_put")
    @patch.object(semantic, "model_detail", return_value={"defined": True})
    def test_count_star_measure_is_allowed(self, _detail, put, _refs, _sm, _marts, _get):
        semantic.save_model("mart_sales", {"businessName": "매출", "measures": [{
            "column": None, "businessName": "주문 건수", "aggregation": "COUNT",
            "displayFormat": "number",
        }]})
        saved_fields = put.call_args.args[2]
        self.assertIsNone(saved_fields[0]["column_name"])
        self.assertEqual(saved_fields[0]["aggregation"], "COUNT")


class SemanticResolverTest(unittest.TestCase):
    @patch.object(semantic.manifest, "get", return_value=ENTRY)
    @patch.object(semantic.store, "marts", return_value={"mart_sales"})
    @patch.object(semantic.store, "metric_by_key")
    @patch.object(semantic.store, "semantic_model_get")
    def test_resolves_to_existing_analytics_spec(self, get_sm, metric_by_key, _marts, _get):
        get_sm.return_value = {
            "model_id": "mart_sales", "business_name": "sales",
            "fields": [
                {"id": "sf_month", "kind": "dimension", "column_name": "order_month",
                 "business_name": "주문 월"},
                {"id": "sf_sales", "kind": "measure", "column_name": "total_amount",
                 "business_name": "총 매출", "aggregation": "SUM"},
            ],
        }
        metric_by_key.return_value = {
            "id": "mt_sales", "metric_key": "total_sales", "model_id": "mart_sales",
            "measure_id": "sf_sales", "display_name": "총 매출",
        }
        out = semantic.resolve({"semanticModel": "mart_sales",
                                "dimensions": ["order_month"],
                                "metrics": ["total_sales"]})
        self.assertEqual(out["modelId"], "mart_sales")
        self.assertEqual(out["dimensions"], ["order_month"])
        self.assertEqual(out["metrics"][0]["col"], "total_amount")
        self.assertEqual(out["metrics"][0]["agg"], "SUM")

    @patch.object(semantic.manifest, "get", return_value=ENTRY)
    @patch.object(semantic.store, "marts", return_value={"mart_sales"})
    @patch.object(semantic.store, "metric_by_key", return_value=None)
    @patch.object(semantic.store, "semantic_model_get")
    def test_metric_from_another_model_is_rejected(self, get_sm, _metric, _marts, _get):
        get_sm.return_value = {"model_id": "mart_sales", "business_name": "sales", "fields": []}
        with self.assertRaises(ApiError) as raised:
            semantic.resolve({"semanticModel": "mart_sales", "metrics": ["other_metric"]})
        self.assertEqual(raised.exception.code, "SEMANTIC_METRIC_NOT_FOUND")


class SemanticDeleteTest(unittest.TestCase):
    @patch.object(semantic.store, "semantic_model_delete", return_value=True)
    @patch.object(semantic.store, "semantic_model_get", return_value={"model_id": "mart_sales"})
    def test_delete_uses_cascading_store_cleanup(self, _get, delete):
        out = semantic.delete_model("mart_sales")
        delete.assert_called_once_with("mart_sales")
        self.assertEqual(out["deleted"], "mart_sales")


class MartRegressionTest(unittest.TestCase):
    @patch.object(mart, "_entry", return_value=ENTRY)
    @patch.object(mart.store, "marts", return_value=set())
    @patch.object(mart.store, "mart_set")
    @patch.object(mart, "_sync_one", return_value=(True, ""))
    @patch.object(mart, "mart_status", return_value={"isMart": True})
    def test_existing_mart_mark_flow_still_works(
            self, status, _sync, set_mart, _marts, _entry):
        out = mart.mark_mart("mart_sales")
        set_mart.assert_called_once_with("mart_sales", True)
        self.assertTrue(out["isMart"])

    @patch.object(mart, "_entry", return_value=ENTRY)
    @patch.object(mart.store, "marts", return_value={"mart_sales"})
    @patch.object(mart.store, "semantic_model_get", return_value={"model_id": "mart_sales"})
    def test_mart_unmark_is_blocked_while_semantic_definition_exists(
            self, _semantic, _marts, _entry):
        with self.assertRaises(ApiError) as raised:
            mart.unmark_mart("mart_sales")
        self.assertEqual(raised.exception.code, "SEMANTIC_MODEL_IN_USE")

    @patch.object(mart, "_entry", return_value=ENTRY)
    @patch.object(mart.store, "marts", return_value={"mart_sales"})
    @patch.object(mart.store, "semantic_model_get", return_value=None)
    @patch.object(mart, "mart_usage", return_value={"canUnmark": True})
    @patch.object(mart.store, "mart_set")
    @patch.object(mart, "mart_status", return_value={"isMart": False})
    def test_existing_mart_unmark_flow_still_works(
            self, status, set_mart, _usage, _semantic, _marts, _entry):
        out = mart.unmark_mart("mart_sales")
        set_mart.assert_called_once_with("mart_sales", False)
        self.assertFalse(out["isMart"])


if __name__ == "__main__":
    unittest.main()
