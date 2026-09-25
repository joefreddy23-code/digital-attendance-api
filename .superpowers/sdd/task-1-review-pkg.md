# Review Package Task 1
Base: b3445719ae8c5220c242bfc08f7f4baa997a1b8c
Head: 3ee9b4d0239209c7ab114c117184a0727e320f19

## Commits
3ee9b4d Add web_getEmployeeProfileImgPath SP for profile image lookup.

## Stat
 .../plans/sql/web_getEmployeeProfileImgPath.sql     | 21 +++++++++++++++++++++  1 file changed, 21 insertions(+)

## Diff
```diff
diff --git a/Web-app/docs/superpowers/plans/sql/web_getEmployeeProfileImgPath.sql b/Web-app/docs/superpowers/plans/sql/web_getEmployeeProfileImgPath.sql new file mode 100644 index 0000000..d72e3e2 --- /dev/null +++ b/Web-app/docs/superpowers/plans/sql/web_getEmployeeProfileImgPath.sql @@ -0,0 +1,21 @@ +DROP PROCEDURE IF EXISTS web_getEmployeeProfileImgPath; + +DELIMITER $$ + +CREATE PROCEDURE web_getEmployeeProfileImgPath( +    IN p_empId INT, +    IN p_email VARCHAR(255) +) +BEGIN +    SELECT profileImgPath +    FROM employee +    WHERE (p_empId IS NOT NULL AND empId = p_empId) +       OR ( +            p_empId IS NULL +            AND p_email IS NOT NULL +            AND email = p_email +          ) +    LIMIT 1; +END$$ + +DELIMITER ;
```
