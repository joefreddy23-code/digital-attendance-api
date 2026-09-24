# Review package Task 1
Base: (no git — empty tree)
Head: working tree after Task 1

## Commit list
(none — no git repository)

## Stat
 docs/superpowers/plans/sql/web_upsertEmployee.sql | new file

## Full diff
diff --git a/docs/superpowers/plans/sql/web_upsertEmployee.sql b/docs/superpowers/plans/sql/web_upsertEmployee.sql
new file mode 100644
--- /dev/null
+++ b/docs/superpowers/plans/sql/web_upsertEmployee.sql
+DROP PROCEDURE IF EXISTS `web_upsertEmployee`;
+
+DELIMITER $$
+
+CREATE DEFINER=`root`@`localhost` PROCEDURE `web_upsertEmployee`(
+    IN p_empId INT,
+    IN p_fullName VARCHAR(100),
+    IN p_joiningDate DATE,
+    IN p_email VARCHAR(150),
+    IN p_mobileNumber VARCHAR(20),
+    IN p_roleId INT,
+    IN p_designationId INT,
+    IN p_locationIds VARCHAR(1000),
+    IN p_password VARCHAR(100)
+)
+BEGIN
+
+    DECLARE v_empId INT;
+
+    START TRANSACTION;
+
+
+    -- ============================================================
+    -- INSERT EMPLOYEE
+    -- ============================================================
+
+    IF p_empId IS NULL OR p_empId = 0 THEN
+
+        IF p_password IS NULL OR p_password = '' THEN
+
+            ROLLBACK;
+
+            SIGNAL SQLSTATE '45000'
+                SET MESSAGE_TEXT = 'Password is required for new employees';
+
+        END IF;
+
+        INSERT INTO employee
+        (
+            name,
+            joiningDate,
+            email,
+            mobileNumber,
+            roleId,
+            designationId,
+            password,
+            active
+        )
+        VALUES
+        (
+            p_fullName,
+            p_joiningDate,
+            p_email,
+            p_mobileNumber,
+            p_roleId,
+            p_designationId,
+            MD5(p_password),
+            1
+        );
+
+        SET v_empId = LAST_INSERT_ID();
+
+
+    -- ============================================================
+    -- UPDATE EMPLOYEE (password is never updated here)
+    -- ============================================================
+
+    ELSE
+
+        IF NOT EXISTS (
+            SELECT 1
+            FROM employee
+            WHERE id = p_empId
+        ) THEN
+
+            ROLLBACK;
+
+            SIGNAL SQLSTATE '45000'
+                SET MESSAGE_TEXT = 'Employee not found';
+
+        END IF;
+
+
+        UPDATE employee
+        SET
+            name = p_fullName,
+            joiningDate = p_joiningDate,
+            email = p_email,
+            mobileNumber = p_mobileNumber,
+            roleId = p_roleId,
+            designationId = p_designationId
+        WHERE id = p_empId;
+
+        SET v_empId = p_empId;
+
+    END IF;
+
+
+    -- ============================================================
+    -- LOCATION ASSIGNMENTS
+    -- ============================================================
+
+    DELETE FROM employeelocation
+    WHERE empId = v_empId
+      AND locationId NOT IN (
+          SELECT CAST(j.locationId AS UNSIGNED)
+          FROM JSON_TABLE(
+              CONCAT('[', p_locationIds, ']'),
+              '$[*]' COLUMNS (
+                  locationId VARCHAR(50) PATH '$'
+              )
+          ) j
+      );
+
+
+    INSERT INTO employeelocation
+    (
+        empId,
+        locationId
+    )
+    SELECT
+        v_empId,
+        CAST(j.locationId AS UNSIGNED)
+    FROM JSON_TABLE(
+        CONCAT('[', p_locationIds, ']'),
+        '$[*]' COLUMNS (
+            locationId VARCHAR(50) PATH '$'
+        )
+    ) j
+    WHERE NOT EXISTS (
+        SELECT 1
+        FROM employeelocation el
+        WHERE el.empId = v_empId
+          AND el.locationId = CAST(j.locationId AS UNSIGNED)
+    );
+
+
+    COMMIT;
+
+
+    SELECT
+        v_empId AS empId,
+        'Employee saved successfully' AS message;
+
+END$$
+
+DELIMITER ;
+

